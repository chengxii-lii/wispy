// wispy-helper: what is playing (system media session) and how loud it is (output peak meter).
// Windows.Media.Control is called straight through the WinRT metadata, so no extra runtime is needed.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation
{
    [PreserveSig] int GetPeakValue(out float peak);
    [PreserveSig] int GetMeteringChannelCount(out uint n);
    [PreserveSig] int GetChannelsPeakValues(uint n, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] float[] v);
    [PreserveSig] int QueryHardwareSupport(out uint mask);
}

static partial class Program
{
    static void StartMedia()
    {
        // a Windows without the media session types fails when MediaLoop is first compiled, so call it inside a try
        Thread mt = new Thread(delegate() { try { MediaLoop(); } catch (Exception) { } });
        mt.IsBackground = true; mt.Name = "media";
        mt.Start();
        Thread lt = new Thread(delegate() { try { MeterLoop(); } catch (Exception) { } });
        lt.IsBackground = true; lt.Name = "meter";
        lt.Start();
    }

    // ---- now playing: polled once a second, emitted only when it changes
    static T WaitOp<T>(IAsyncOperation<T> op)
    {
        ManualResetEvent ev = new ManualResetEvent(false);
        op.Completed = delegate(IAsyncOperation<T> o, AsyncStatus s) { ev.Set(); };
        if (!ev.WaitOne(3000)) throw new TimeoutException();
        return op.GetResults();
    }

    static void MediaLoop()
    {
        string lastKey = null;
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
                GlobalSystemMediaTransportControlsSession use = pick != null ? pick : any;
                if (use != null)
                {
                    GlobalSystemMediaTransportControlsSessionMediaProperties p = WaitOp(use.TryGetMediaPropertiesAsync());
                    title = p.Title ?? ""; artist = p.Artist ?? ""; app = use.SourceAppUserModelId ?? "";
                    playing = pick != null && title.Length > 0;
                }
                string key = playing + "|" + title + "|" + artist;
                if (key != lastKey)
                {
                    lastKey = key;
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["playing"] = playing; d["title"] = title; d["artist"] = artist; d["app"] = app;
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
            Thread.Sleep(1000);
        }
    }

    // ---- output level: the default speaker's peak, about 30 times a second, only sent when it moves
    static void MeterLoop()
    {
        IAudioMeterInformation meter = null;
        int sinceAcquire = 0; float last = -1f;
        while (true)
        {
            try
            {
                if (meter == null || ++sinceAcquire > 90)
                {
                    sinceAcquire = 0;
                    meter = null;
                    IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
                    IMMDevice dev;
                    if (en.GetDefaultAudioEndpoint(0, 1, out dev) == 0 && dev != null)
                    {
                        Guid iid = typeof(IAudioMeterInformation).GUID; object o;
                        if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) == 0) meter = (IAudioMeterInformation)o;
                    }
                }
                float p = 0f;
                if (meter != null && meter.GetPeakValue(out p) != 0) { meter = null; p = 0f; }
                p = (float)Math.Round(Math.Max(0f, Math.Min(1f, p)), 2);
                if (p != last)
                {
                    last = p;
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["v"] = p;
                    Emit("level", d);
                }
            }
            catch (Exception) { meter = null; }
            Thread.Sleep(33);
        }
    }
}
