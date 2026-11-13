// wispy-helper: what is playing (system media session: title, artist, cover, position, controls) and what it
// sounds like (a 32-band spectrum of whatever the default speakers play, taken with WASAPI loopback).
// Windows.Media.Control is called straight through the WinRT metadata, so no extra runtime is needed.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation
{
    [PreserveSig] int GetPeakValue(out float peak);
    [PreserveSig] int GetMeteringChannelCount(out uint n);
    [PreserveSig] int GetChannelsPeakValues(uint n, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] float[] v);
    [PreserveSig] int QueryHardwareSupport(out uint mask);
}

[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient
{
    [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    [PreserveSig] int GetBufferSize(out uint n);
    [PreserveSig] int GetStreamLatency(out long l);
    [PreserveSig] int GetCurrentPadding(out uint n);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr fmt, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr fmt);
    [PreserveSig] int GetDevicePeriod(out long def, out long min);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr h);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object svc);
}

[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient
{
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devPos, out ulong qpcPos);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
}

static partial class Program
{
    static void StartMedia()
    {
        // a Windows without the media session types fails when MediaLoop is first compiled, so call it inside a try
        Thread mt = new Thread(delegate() { try { MediaLoop(); } catch (Exception) { } });
        mt.IsBackground = true; mt.Name = "media";
        mt.Start();
        Thread lt = new Thread(delegate() { try { VizLoop(); } catch (Exception) { } });
        lt.IsBackground = true; lt.Name = "viz";
        lt.Start();
    }

    // ---- now playing: polled once a second (or at once after a command), emitted only when it changes
    static T WaitOp<T>(IAsyncOperation<T> op)
    {
        ManualResetEvent ev = new ManualResetEvent(false);
        op.Completed = delegate(IAsyncOperation<T> o, AsyncStatus s) { ev.Set(); };
        if (!ev.WaitOne(3000)) throw new TimeoutException();
        return op.GetResults();
    }

    static GlobalSystemMediaTransportControlsSession mediaSession;
    static readonly AutoResetEvent mediaWake = new AutoResetEvent(false);
    static int artCounter = 0;

    static string SaveArt(IRandomAccessStreamReference thumb)
    {
        if (thumb == null) return "";
        try
        {
            IRandomAccessStreamWithContentType st = WaitOp(thumb.OpenReadAsync());
            ulong size = st.Size;
            if (size == 0 || size > 6000000) return "";
            DataReader rd = new DataReader(st.GetInputStreamAt(0));
            WaitOp(rd.LoadAsync((uint)size));
            byte[] buf = new byte[size];
            rd.ReadBytes(buf);
            string dir = Path.Combine(Path.GetTempPath(), "wispy-art");
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, "a" + (++artCounter) + ".img");
            File.WriteAllBytes(file, buf);
            try { string old = Path.Combine(dir, "a" + (artCounter - 3) + ".img"); if (File.Exists(old)) File.Delete(old); } catch { }
            return file;
        }
        catch (Exception) { return ""; }
    }

    static void MediaCommand(string action, double pos)
    {
        GlobalSystemMediaTransportControlsSession s = mediaSession;
        if (s == null) return;
        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                if (action == "toggle") WaitOp(s.TryTogglePlayPauseAsync());
                else if (action == "next") WaitOp(s.TrySkipNextAsync());
                else if (action == "prev") WaitOp(s.TrySkipPreviousAsync());
                else if (action == "seek") WaitOp(s.TryChangePlaybackPositionAsync((long)(pos * 10000000.0)));
            }
            catch (Exception) { }
            mediaWake.Set();
        });
    }

    static void MediaLoop()
    {
        string lastKey = null, art = "", artKey = "";
        double lastPos = 0, lastEmitAt = 0;
        GlobalSystemMediaTransportControlsSessionManager mgr = null;
        int fails = 0;
        while (true)
        {
            try
            {
                if (mgr == null) mgr = WaitOp(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
                GlobalSystemMediaTransportControlsSession pick = null, any = null;
                foreach (GlobalSystemMediaTransportControlsSession s in mgr.GetSessions())
                {
                    if (any == null) any = s;
                    if (s.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                    {
                        // the system's current session wins a tie between two players
                        if (pick == null) pick = s;
                        GlobalSystemMediaTransportControlsSession cur = mgr.GetCurrentSession();
                        if (cur != null && cur.SourceAppUserModelId == s.SourceAppUserModelId) pick = s;
                    }
                }
                string title = "", artist = "", app = ""; bool playing = false;
                bool canNext = false, canPrev = false, canSeek = false;
                double pos = 0, dur = 0;
                GlobalSystemMediaTransportControlsSession use = pick != null ? pick : any;
                mediaSession = use;
                if (use != null)
                {
                    GlobalSystemMediaTransportControlsSessionMediaProperties p = WaitOp(use.TryGetMediaPropertiesAsync());
                    title = p.Title ?? ""; artist = p.Artist ?? ""; app = use.SourceAppUserModelId ?? "";
                    playing = pick != null && title.Length > 0;
                    // the extras must never take the title down with them
                    try
                    {
                        GlobalSystemMediaTransportControlsSessionPlaybackControls c = use.GetPlaybackInfo().Controls;
                        canNext = c.IsNextEnabled; canPrev = c.IsPreviousEnabled; canSeek = c.IsPlaybackPositionEnabled;
                    }
                    catch (Exception) { }
                    try
                    {
                        GlobalSystemMediaTransportControlsSessionTimelineProperties tl = use.GetTimelineProperties();
                        dur = (tl.EndTime - tl.StartTime).TotalSeconds;
                        pos = tl.Position.TotalSeconds;
                        if (playing) pos += Math.Max(0, (DateTimeOffset.Now - tl.LastUpdatedTime).TotalSeconds);
                        if (dur > 0 && pos > dur) pos = dur;
                        if (double.IsNaN(pos) || double.IsNaN(dur) || dur < 0 || pos < 0) { pos = 0; dur = 0; }
                    }
                    catch (Exception) { pos = 0; dur = 0; }
                    string ak = app + "|" + title + "|" + artist + "|" + (p.AlbumTitle ?? "");
                    if (ak != artKey) { artKey = ak; try { art = SaveArt(p.Thumbnail); } catch (Exception) { art = ""; } }
                }
                else { art = ""; artKey = ""; }
                string key = playing + "|" + title + "|" + artist + "|" + art + "|" + canNext + canPrev + canSeek + "|" + (int)dur;
                double now = (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
                // a seek or a stall shows up as the position leaving the straight line we last reported
                double expected = lastPos + (playing ? (now - lastEmitAt) / 1000.0 : 0);
                bool jumped = Math.Abs(pos - expected) > 2.5;
                if (key != lastKey || jumped)
                {
                    lastKey = key; lastPos = pos; lastEmitAt = now;
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["playing"] = playing; d["title"] = title; d["artist"] = artist; d["app"] = app;
                    d["art"] = art; d["pos"] = pos; d["dur"] = dur; d["at"] = now;
                    d["canNext"] = canNext; d["canPrev"] = canPrev; d["canSeek"] = canSeek;
                    Emit("media", d);
                }
                fails = 0;
            }
            catch (Exception)
            {
                mgr = null;
                if (++fails > 20) return;   // no media session service on this Windows: stop trying
                Thread.Sleep(4000);
            }
            mediaWake.WaitOne(1000);
        }
    }

    // ---- spectrum: WASAPI loopback of the default speakers, only while the page asks for it
    static volatile bool vizOn = false;
    static readonly ManualResetEvent vizSignal = new ManualResetEvent(false);
    const int BANDS = 32, FFT_N = 1024;

    static void SetViz(bool on)
    {
        vizOn = on;
        if (on) vizSignal.Set(); else vizSignal.Reset();
    }

    static void Fft(double[] re, double[] im)
    {
        int n = re.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (int len = 2; len <= n; len <<= 1)
        {
            double ang = -2 * Math.PI / len, wr = Math.Cos(ang), wi = Math.Sin(ang);
            for (int i = 0; i < n; i += len)
            {
                double cr = 1, ci = 0;
                for (int k = 0; k < len / 2; k++)
                {
                    int a = i + k, b = i + k + len / 2;
                    double xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
                    double nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
                }
            }
        }
    }

    static int[] Spectrum(float[] ring, int head, int rate, double[] re, double[] im, double[] win)
    {
        for (int i = 0; i < FFT_N; i++) { re[i] = ring[(head + i) % FFT_N] * win[i]; im[i] = 0; }
        Fft(re, im);
        double binHz = (double)rate / FFT_N;
        int[] outv = new int[BANDS];
        for (int b = 0; b < BANDS; b++)
        {
            double f0 = 50 * Math.Pow(14000.0 / 50, (double)b / BANDS), f1 = 50 * Math.Pow(14000.0 / 50, (double)(b + 1) / BANDS);
            int i0 = (int)Math.Ceiling(f0 / binHz), i1 = (int)Math.Floor(f1 / binHz);
            double m = 0;
            if (i1 < i0)
            {
                double fc = (f0 + f1) / 2 / binHz; int lo = (int)Math.Floor(fc); double fr = fc - lo;
                double a = Math.Sqrt(re[lo] * re[lo] + im[lo] * im[lo]), c = Math.Sqrt(re[lo + 1] * re[lo + 1] + im[lo + 1] * im[lo + 1]);
                m = a * (1 - fr) + c * fr;
            }
            else for (int i = i0; i <= i1 && i < FFT_N / 2; i++) m = Math.Max(m, Math.Sqrt(re[i] * re[i] + im[i] * im[i]));
            double amp = m / (FFT_N / 4.0);
            double db = 20 * Math.Log10(amp + 1e-9) + 3.0 * Math.Log((f0 + f1) / 2 / 100.0, 2);   // +3 dB per octave so highs are not buried
            outv[b] = (int)Math.Round(100 * Math.Max(0, Math.Min(1, (db + 72) / 55)));
        }
        return outv;
    }

    static void EmitSpectrum(int[] v)
    {
        List<object> l = new List<object>(BANDS);
        for (int i = 0; i < v.Length; i++) l.Add(v[i]);
        Dictionary<string, object> d = new Dictionary<string, object>();
        d["b"] = l;
        Emit("spectrum", d);
    }

    static void VizLoop()
    {
        double[] re = new double[FFT_N], im = new double[FFT_N], win = new double[FFT_N];
        for (int i = 0; i < FFT_N; i++) win[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (FFT_N - 1));
        float[] ring = new float[FFT_N];
        while (true)
        {
            vizSignal.WaitOne();
            IAudioClient client = null; IAudioCaptureClient cap = null; IAudioMeterInformation meter = null;
            int rate = 48000, channels = 2, bits = 32; bool isFloat = true;
            string devId = null;
            try
            {
                IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
                IMMDevice dev;
                if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) { Thread.Sleep(1000); continue; }
                dev.GetId(out devId);
                object o;
                Guid iidMeter = typeof(IAudioMeterInformation).GUID;
                if (dev.Activate(ref iidMeter, 23, IntPtr.Zero, out o) == 0) meter = (IAudioMeterInformation)o;
                Guid iidClient = typeof(IAudioClient).GUID;
                if (dev.Activate(ref iidClient, 23, IntPtr.Zero, out o) == 0)
                {
                    client = (IAudioClient)o;
                    IntPtr fmt;
                    if (client.GetMixFormat(out fmt) == 0)
                    {
                        int tag = Marshal.ReadInt16(fmt, 0);
                        channels = Marshal.ReadInt16(fmt, 2); rate = Marshal.ReadInt32(fmt, 4); bits = Marshal.ReadInt16(fmt, 14);
                        isFloat = tag == 3;
                        if (tag == unchecked((short)0xFFFE)) isFloat = Marshal.ReadInt16(fmt, 24) == 3;   // extensible: the sub-format says which
                        // flags 0x20000 = loopback; 2,000,000 x 100 ns = 200 ms buffer
                        if (client.Initialize(0, 0x00020000, 2000000, 0, fmt, IntPtr.Zero) == 0)
                        {
                            Guid iidCap = typeof(IAudioCaptureClient).GUID; object cc;
                            if (client.GetService(ref iidCap, out cc) == 0) { cap = (IAudioCaptureClient)cc; client.Start(); }
                        }
                        Marshal.FreeCoTaskMem(fmt);
                    }
                }
            }
            catch (Exception) { }
            bool canTap = cap != null && (isFloat ? bits == 32 : (bits == 16 || bits == 32 || bits == 24));
            int head = 0, loops = 0; DateTime lastData = DateTime.UtcNow; bool wasSilent = false;
            Array.Clear(ring, 0, ring.Length);
            while (vizOn)
            {
                try
                {
                    if (canTap)
                    {
                        uint pk;
                        while (cap.GetNextPacketSize(out pk) == 0 && pk > 0)
                        {
                            IntPtr data; uint frames, flags; ulong dp, qp;
                            if (cap.GetBuffer(out data, out frames, out flags, out dp, out qp) != 0) break;
                            bool silent = (flags & 2) != 0;
                            int step = bits / 8;
                            for (uint f = 0; f < frames; f++)
                            {
                                float s = 0;
                                if (!silent)
                                {
                                    for (int ch = 0; ch < channels; ch++)
                                    {
                                        int off = (int)((f * channels + ch) * step);
                                        if (isFloat) { s += BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(data, off)), 0); }
                                        else if (bits == 16) s += Marshal.ReadInt16(data, off) / 32768f;
                                        else if (bits == 24) s += ((Marshal.ReadByte(data, off + 2) << 24 | Marshal.ReadByte(data, off + 1) << 16 | Marshal.ReadByte(data, off) << 8) >> 8) / 8388608f;
                                        else s += Marshal.ReadInt32(data, off) / 2147483648f;
                                    }
                                    s /= channels;
                                }
                                ring[head] = s; head = (head + 1) % FFT_N;
                            }
                            cap.ReleaseBuffer(frames);
                            if (!silent) lastData = DateTime.UtcNow;
                        }
                        bool quiet = (DateTime.UtcNow - lastData).TotalMilliseconds > 150;
                        if (quiet)
                        {
                            if (!wasSilent) { EmitSpectrum(new int[BANDS]); wasSilent = true; }
                        }
                        else { wasSilent = false; EmitSpectrum(Spectrum(ring, head, rate, re, im, win)); }
                    }
                    else if (meter != null)
                    {
                        // no loopback on this device: every band shows the peak
                        float p = 0; meter.GetPeakValue(out p);
                        int v = (int)Math.Round(100 * Math.Sqrt(Math.Max(0, Math.Min(1, p))));
                        if (v > 0 || !wasSilent) { int[] a = new int[BANDS]; for (int i = 0; i < BANDS; i++) a[i] = v; EmitSpectrum(a); }
                        wasSilent = v == 0;
                    }
                    if (++loops % 100 == 0)
                    {
                        // the default speakers changed (headphones plugged in): start over on the new device
                        IMMDeviceEnumerator en2 = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice d2; string id2;
                        if (en2.GetDefaultAudioEndpoint(0, 1, out d2) == 0 && d2 != null) { d2.GetId(out id2); if (id2 != devId) break; }
                    }
                }
                catch (Exception) { break; }
                Thread.Sleep(33);
            }
            try { if (client != null) client.Stop(); } catch (Exception) { }
            cap = null; client = null; meter = null;
            if (!vizOn) EmitSpectrum(new int[BANDS]); else Thread.Sleep(500);
        }
    }
}
