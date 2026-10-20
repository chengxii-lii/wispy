// neon-helper extras: audio devices + per-app volume, input languages, the tray-icon host,
// and Windows banner suppression. C# 5 (in-box csc), same as Helper.cs.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[StructLayout(LayoutKind.Sequential)]
struct PROPERTYKEY { public Guid fmtid; public int pid; }

[StructLayout(LayoutKind.Explicit, Size = 24)]
struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore
{
    [PreserveSig] int GetCount(out uint n);
    [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
    [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection
{
    [PreserveSig] int GetCount(out uint n);
    [PreserveSig] int Item(uint i, out IMMDevice d);
}

// Undocumented but stable since Windows 7: the only way to change the default audio device.
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
class PolicyConfigClient { }

[ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig
{
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr f);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int d, IntPtr f);
    [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr a, IntPtr b);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int d, IntPtr a, IntPtr b);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr p);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr m);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr m);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr k, IntPtr v);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr k, IntPtr v);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int v);
}

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2
{
    [PreserveSig] int GetAudioSessionControl(IntPtr g, int f, out IntPtr c);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr g, int f, out IntPtr v);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
}

[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator
{
    [PreserveSig] int GetCount(out int n);
    [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s);
}

[ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2
{
    [PreserveSig] int GetState(out int s);
    [PreserveSig] int GetDisplayName(out IntPtr n);
    [PreserveSig] int SetDisplayName(IntPtr n, IntPtr c);
    [PreserveSig] int GetIconPath(out IntPtr p);
    [PreserveSig] int SetIconPath(IntPtr p, IntPtr c);
    [PreserveSig] int GetGroupingParam(out Guid g);
    [PreserveSig] int SetGroupingParam(IntPtr g, IntPtr c);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int GetSessionIdentifier(out IntPtr s);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr s);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool o);
}

[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume
{
    [PreserveSig] int SetMasterVolume(float v, ref Guid c);
    [PreserveSig] int GetMasterVolume(out float v);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid c);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}

static class NX
{
    public delegate IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASSEX
    {
        public uint cbSize; public uint style; public WndProc lpfnWndProc; public int cbClsExtra; public int cbWndExtra;
        public IntPtr hInstance; public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground;
        public string lpszMenuName; public string lpszClassName; public IntPtr hIconSm;
    }
    [StructLayout(LayoutKind.Sequential)] public struct COPYDATASTRUCT { public IntPtr dwData; public int cbData; public IntPtr lpData; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern ushort RegisterClassEx(ref WNDCLASSEX c);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] public static extern IntPtr DefWindowProc(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string s);
    [DllImport("user32.dll")] public static extern bool SendNotifyMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint pid);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("user32.dll")] public static extern int GetKeyboardLayoutList(int n, [Out] IntPtr[] list);
}

class TrayIcon
{
    public string key; public long hwnd, uid, cbMsg, hIcon, pngIcon; public string tip = ""; public bool hidden; public int version; public string png = "";
}

static partial class Program
{
    // ================================================================ start / dispatch
    static string bannerFile;
    static readonly string trayDir = Path.Combine(Path.GetTempPath(), "neon-tray");

    static void StartExtras()
    {
        bannerFile = Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "neon"), "banners.txt");
        try { Directory.CreateDirectory(trayDir); } catch { }
        try { StartTrayHost(); } catch { }
        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
        t.Interval = 250;
        t.Tick += delegate { try { EmitTray(false); } catch { } };
        t.Start();
    }

    static void HandleExtra(string cmd, Dictionary<string, object> m)
    {
        switch (cmd)
        {
            case "audio": { long id = Lng(m, "id"); ui.BeginInvoke(new Action(delegate { EmitAudio(id); })); break; }
            case "setAudioDevice": { string did = Str(m, "devId"); ui.BeginInvoke(new Action(delegate { SetDefaultDevice(did); })); break; }
            case "setAppVolume":
                {
                    string key = Str(m, "key");
                    float vol = m.ContainsKey("vol") ? (float)Convert.ToDouble(m["vol"]) : -1f;
                    int mu = m.ContainsKey("muted") ? (Convert.ToBoolean(m["muted"]) ? 1 : 0) : -1;
                    ui.BeginInvoke(new Action(delegate { SetAppVolume(key, vol, mu); }));
                    break;
                }
            case "trayClick": { string key = Str(m, "key"), b = Str(m, "button"); ui.BeginInvoke(new Action(delegate { TrayClick(key, b); })); break; }
            case "trayRefresh": ui.BeginInvoke(new Action(delegate { EmitTray(true); })); break;
            case "bannersOff": ui.BeginInvoke(new Action(BannersOff)); break;
            default: HandleExtra2(cmd, m); break;
        }
    }

    // called from PollWindows (UI thread, every 600ms)
    static IntPtr lastExternalFg = IntPtr.Zero, lastExplorer = IntPtr.Zero;
    static int rebroadcastAt = 0, topTick = 0;
    static string lastLangJson = "";

    static void PollExtras(IntPtr fg)
    {
        if (fg != IntPtr.Zero)
        {
            uint pid; Native.GetWindowThreadProcessId(fg, out pid);
            string exe = ExeOf(pid).ToLowerInvariant();
            if (exe.Length > 0 && exe != selfExe) lastExternalFg = fg;
        }
        PollLang();

        // keep our tray host above Explorer's; if Explorer restarted, ask apps to re-add their icons
        if (trayHost != IntPtr.Zero)
        {
            IntPtr exp = ExplorerTray();
            if (exp != lastExplorer) { lastExplorer = exp; BringHostToTop(); rebroadcastAt = Environment.TickCount + 2500; }
            if (++topTick % 5 == 0) BringHostToTop();
            if (rebroadcastAt != 0 && Environment.TickCount >= rebroadcastAt) { rebroadcastAt = 0; Broadcast(); }
        }
    }

    // ================================================================ audio
    static string FriendlyName(IMMDevice d)
    {
        IPropertyStore ps;
        if (d.OpenPropertyStore(0, out ps) != 0 || ps == null) return "";
        PROPERTYKEY k = new PROPERTYKEY();
        k.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); k.pid = 14;
        PROPVARIANT v;
        if (ps.GetValue(ref k, out v) != 0) return "";
        return v.vt == 31 && v.p != IntPtr.Zero ? Marshal.PtrToStringUni(v.p) : "";
    }

    static IEnumerable<KeyValuePair<string, IAudioSessionControl2>> SessionsOf(IMMDevice dev)
    {
        List<KeyValuePair<string, IAudioSessionControl2>> l = new List<KeyValuePair<string, IAudioSessionControl2>>();
        Guid iid = typeof(IAudioSessionManager2).GUID;
        object o;
        if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return l;
        IAudioSessionEnumerator e;
        if (((IAudioSessionManager2)o).GetSessionEnumerator(out e) != 0) return l;
        int n; e.GetCount(out n);
        for (int i = 0; i < n; i++)
        {
            IAudioSessionControl2 c;
            if (e.GetSession(i, out c) != 0 || c == null) continue;
            int st; c.GetState(out st);
            if (st == 2) continue; // expired
            bool sys = c.IsSystemSoundsSession() == 0;
            uint pid; c.GetProcessId(out pid);
            string exe = sys ? "" : ExeOf(pid);
            if (!sys && exe.Length == 0) continue;
            l.Add(new KeyValuePair<string, IAudioSessionControl2>(sys ? "system" : exe.ToLowerInvariant(), c));
        }
        return l;
    }

    static void EmitAudio(long id)
    {
        List<object> devs = new List<object>(), apps = new List<object>();
        try
        {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            string defId = "";
            IMMDevice def;
            if (en.GetDefaultAudioEndpoint(0, 1, out def) == 0 && def != null) def.GetId(out defId);
            IMMDeviceCollection col;
            if (en.EnumAudioEndpoints(0, 1, out col) == 0 && col != null)
            {
                uint n; col.GetCount(out n);
                for (uint i = 0; i < n; i++)
                {
                    IMMDevice d;
                    if (col.Item(i, out d) != 0 || d == null) continue;
                    string did; d.GetId(out did);
                    Dictionary<string, object> x = new Dictionary<string, object>();
                    x["id"] = did; x["name"] = FriendlyName(d); x["default"] = did == defId;
                    devs.Add(x);
                }
            }
            if (def != null)
            {
                HashSet<string> seen = new HashSet<string>();
                foreach (KeyValuePair<string, IAudioSessionControl2> s in SessionsOf(def))
                {
                    if (!seen.Add(s.Key)) continue;
                    ISimpleAudioVolume v = (ISimpleAudioVolume)s.Value;
                    float vol; bool mute;
                    v.GetMasterVolume(out vol); v.GetMute(out mute);
                    Dictionary<string, object> x = new Dictionary<string, object>();
                    x["key"] = s.Key;
                    x["exe"] = s.Key == "system" ? "" : s.Key;
                    string nm = s.Key == "system" ? "System sounds" : NameOf(s.Key, "");
                    if (nm.Length == 0) nm = CultureInfo.CurrentCulture.TextInfo.ToTitleCase(Path.GetFileNameWithoutExtension(s.Key));
                    x["name"] = nm; x["vol"] = Math.Round(vol * 100.0); x["muted"] = mute;
                    apps.Add(x);
                }
            }
        }
        catch (Exception ex) { Emit("error", new Dictionary<string, object> { { "msg", "audio: " + ex.Message } }); }
        Dictionary<string, object> r = new Dictionary<string, object>();
        r["id"] = id; r["devices"] = devs; r["apps"] = apps;
        Emit("audio", r);
    }

    static void SetDefaultDevice(string id)
    {
        try
        {
            IPolicyConfig pc = (IPolicyConfig)new PolicyConfigClient();
            for (int role = 0; role < 3; role++) pc.SetDefaultEndpoint(id, role);
        }
        catch (Exception ex) { Emit("error", new Dictionary<string, object> { { "msg", "setdevice: " + ex.Message } }); }
        PollVolume();
    }

    static void SetAppVolume(string key, float vol, int mute)
    {
        try
        {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            IMMDevice def;
            if (en.GetDefaultAudioEndpoint(0, 1, out def) != 0 || def == null) return;
            Guid ctx = Guid.Empty;
            foreach (KeyValuePair<string, IAudioSessionControl2> s in SessionsOf(def))
            {
                if (s.Key != key) continue;
                ISimpleAudioVolume v = (ISimpleAudioVolume)s.Value;
                if (vol >= 0) v.SetMasterVolume(Math.Max(0f, Math.Min(1f, vol / 100f)), ref ctx);
                if (mute >= 0) v.SetMute(mute == 1, ref ctx);
            }
        }
        catch { }
    }

    // ================================================================ tray host
    // We register our own Shell_TrayWnd above Explorer's, so Shell_NotifyIcon calls reach us first.
    // Everything is forwarded to Explorer unchanged, so quitting neon loses nothing.
    static IntPtr trayHost = IntPtr.Zero;
    static NX.WndProc trayProc = TrayProc;
    static uint taskbarCreatedMsg;
    static readonly Dictionary<string, TrayIcon> trayIcons = new Dictionary<string, TrayIcon>();
    static readonly List<string> trayOrder = new List<string>();
    static readonly object trayLock = new object();
    static bool trayDirty;
    static string lastTrayJson = "";

    static IntPtr ExplorerTray()
    {
        IntPtr h = IntPtr.Zero;
        while ((h = Native.FindWindowEx(IntPtr.Zero, h, "Shell_TrayWnd", null)) != IntPtr.Zero)
            if (h != trayHost) return h;
        return IntPtr.Zero;
    }

    static void StartTrayHost()
    {
        NX.WNDCLASSEX wc = new NX.WNDCLASSEX();
        wc.cbSize = (uint)Marshal.SizeOf(typeof(NX.WNDCLASSEX));
        wc.lpfnWndProc = trayProc;
        wc.hInstance = Native.GetModuleHandle(null);
        wc.lpszClassName = "Shell_TrayWnd";
        NX.RegisterClassEx(ref wc);
        trayHost = NX.CreateWindowEx(0x80 | 0x8, "Shell_TrayWnd", "", 0x80000000, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
        if (trayHost == IntPtr.Zero) return;
        BringHostToTop();
        taskbarCreatedMsg = NX.RegisterWindowMessage("TaskbarCreated");
        lastExplorer = ExplorerTray();
        Broadcast();
    }

    static void Broadcast() { NX.SendNotifyMessage(new IntPtr(0xffff), taskbarCreatedMsg, IntPtr.Zero, IntPtr.Zero); }
    static void BringHostToTop() { if (trayHost != IntPtr.Zero) NX.SetWindowPos(trayHost, new IntPtr(-1), 0, 0, 0, 0, 0x1 | 0x2 | 0x10); }

    static void StopTrayHost()
    {
        IntPtr h = trayHost;
        trayHost = IntPtr.Zero;
        if (h != IntPtr.Zero) NX.DestroyWindow(h);
    }

    static IntPtr TrayProc(IntPtr h, uint msg, IntPtr w, IntPtr l)
    {
        if (msg == 0x4A) // WM_COPYDATA: tray (1) and appbar (0) traffic
        {
            try
            {
                NX.COPYDATASTRUCT cds = (NX.COPYDATASTRUCT)Marshal.PtrToStructure(l, typeof(NX.COPYDATASTRUCT));
                if (cds.dwData.ToInt64() == 1 && cds.cbData >= 8 + 24 && cds.lpData != IntPtr.Zero) ParseTray(cds.lpData, cds.cbData);
            }
            catch { }
            IntPtr exp = ExplorerTray(), res = IntPtr.Zero;
            if (exp != IntPtr.Zero && Native.SendMessageTimeout(exp, 0x4A, w, l, 2, 2000, out res) != IntPtr.Zero) return res;
            return new IntPtr(1);
        }
        return NX.DefWindowProc(h, msg, w, l);
    }

    static IntPtr Off(IntPtr p, int o) { return new IntPtr(p.ToInt64() + o); }

    static void ParseTray(IntPtr p, int len)
    {
        int nim = Marshal.ReadInt32(p, 4);
        IntPtr n = Off(p, 8);
        int cb = Marshal.ReadInt32(n, 0);
        int avail = Math.Min(cb, len - 8);
        long hwnd = Marshal.ReadInt32(n, 4), uid = (uint)Marshal.ReadInt32(n, 8);
        int flags = Marshal.ReadInt32(n, 12);
        string key = hwnd + ":" + uid;
        if ((flags & 0x20) != 0 && avail >= 952)
        {
            byte[] g = new byte[16];
            Marshal.Copy(Off(n, 936), g, 0, 16);
            key = new Guid(g).ToString();
        }
        lock (trayLock)
        {
            TrayIcon t;
            trayIcons.TryGetValue(key, out t);
            if (nim == 2) // NIM_DELETE
            {
                if (t != null) { trayIcons.Remove(key); trayOrder.Remove(key); trayDirty = true; }
                return;
            }
            if (t == null)
            {
                if (nim != 0 && nim != 1) return;
                t = new TrayIcon(); t.key = key;
                trayIcons[key] = t; trayOrder.Add(key);
            }
            if (hwnd != 0) t.hwnd = hwnd;
            t.uid = uid;
            if (nim == 4) { if (avail >= 804) t.version = Marshal.ReadInt32(n, 800); return; } // NIM_SETVERSION
            if (nim != 0 && nim != 1) return;
            if ((flags & 1) != 0) t.cbMsg = (uint)Marshal.ReadInt32(n, 16);
            if ((flags & 2) != 0) t.hIcon = Marshal.ReadInt32(n, 20);
            if ((flags & 4) != 0 && avail >= 280) t.tip = (Marshal.PtrToStringUni(Off(n, 24)) ?? "").Trim();
            if ((flags & 8) != 0 && avail >= 288)
            {
                int st = Marshal.ReadInt32(n, 280), mask = Marshal.ReadInt32(n, 284);
                if ((mask & 1) != 0) t.hidden = (st & 1) != 0;
            }
            trayDirty = true;
        }
    }

    static void EmitTray(bool force)
    {
        List<object> list = new List<object>();
        lock (trayLock)
        {
            if (!trayDirty && !force && lastTrayJson.Length > 0)
            {
                // still drop icons whose owner window died
                bool dead = false;
                foreach (string k in trayOrder) if (!NX.IsWindow(new IntPtr(trayIcons[k].hwnd))) { dead = true; break; }
                if (!dead) return;
            }
            trayDirty = false;
            foreach (string k in trayOrder.ToArray())
            {
                TrayIcon t = trayIcons[k];
                if (!NX.IsWindow(new IntPtr(t.hwnd))) { trayIcons.Remove(k); trayOrder.Remove(k); continue; }
                if (t.hIcon == 0 || t.hidden) continue;
                if (t.pngIcon != t.hIcon || t.png.Length == 0)
                {
                    try
                    {
                        string f = Path.Combine(trayDir, Math.Abs(k.GetHashCode()).ToString("x") + "_" + t.hIcon.ToString("x") + ".png");
                        if (!File.Exists(f))
                            using (Icon ic = Icon.FromHandle(new IntPtr(t.hIcon)))
                            using (Bitmap b = ic.ToBitmap()) b.Save(f, ImageFormat.Png);
                        t.png = f; t.pngIcon = t.hIcon;
                    }
                    catch { continue; }
                }
                Dictionary<string, object> x = new Dictionary<string, object>();
                x["key"] = k; x["tip"] = t.tip; x["icon"] = t.png;
                list.Add(x);
            }
        }
        Dictionary<string, object> d = new Dictionary<string, object>();
        d["list"] = list;
        string js = Json.Serialize(d);
        if (js != lastTrayJson || force) { lastTrayJson = js; Emit("tray", d); }
    }

    static int MakeLong(int lo, int hi) { return (hi << 16) | (lo & 0xffff); }

    static void TrayClick(string key, string button)
    {
        TrayIcon t;
        lock (trayLock) { if (!trayIcons.TryGetValue(key, out t)) return; }
        IntPtr hw = new IntPtr(t.hwnd);
        uint pid; Native.GetWindowThreadProcessId(hw, out pid);
        NX.AllowSetForegroundWindow(pid);
        // borrow the foreground thread's input state so the app may take focus for its menu
        IntPtr fg = Native.GetForegroundWindow();
        uint fgPid; uint fgT = Native.GetWindowThreadProcessId(fg, out fgPid), me = Native.GetCurrentThreadId();
        bool att = fgT != 0 && fgT != me && Native.AttachThreadInput(me, fgT, true);
        Native.SetForegroundWindow(hw);
        if (att) Native.AttachThreadInput(me, fgT, false);

        NX.POINT pt; NX.GetCursorPos(out pt);
        int[] msgs;
        if (button == "right") msgs = t.version >= 4 ? new int[] { 0x204, 0x205, 0x7B } : new int[] { 0x204, 0x205 };
        else if (button == "double") msgs = new int[] { 0x203 };
        else msgs = t.version >= 4 ? new int[] { 0x201, 0x202, 0x400 } : new int[] { 0x201, 0x202 };
        foreach (int m in msgs)
        {
            IntPtr wp, lp;
            if (t.version >= 4) { wp = new IntPtr(MakeLong(pt.x, pt.y)); lp = new IntPtr(MakeLong(m, (int)t.uid)); }
            else { wp = new IntPtr(t.uid); lp = new IntPtr(m); }
            Native.PostMessage(hw, (uint)t.cbMsg, wp, lp);
        }
    }

    // ================================================================ Windows notification banners
    // neon shows notifications itself, so turn off Windows' own banners per app while it runs.
    // The original values are kept in a file (survives a crash) and put back on quit.
    const string NotifKey = @"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";

    static Dictionary<string, string> LoadBanners()
    {
        Dictionary<string, string> d = new Dictionary<string, string>();
        try
        {
            if (File.Exists(bannerFile))
                foreach (string line in File.ReadAllLines(bannerFile))
                {
                    int i = line.LastIndexOf('\t');
                    if (i > 0) d[line.Substring(0, i)] = line.Substring(i + 1);
                }
        }
        catch { }
        return d;
    }

    static void BannersOff()
    {
        try
        {
            using (RegistryKey root = Registry.CurrentUser.OpenSubKey(NotifKey, true))
            {
                if (root == null) return;
                Dictionary<string, string> saved = LoadBanners();
                bool changed = false;
                foreach (string name in root.GetSubKeyNames())
                {
                    using (RegistryKey k = root.OpenSubKey(name, true))
                    {
                        if (k == null) continue;
                        object v = k.GetValue("ShowBanner");
                        if (!saved.ContainsKey(name)) { saved[name] = v == null ? "absent" : Convert.ToString(v); changed = true; }
                        if (v == null || Convert.ToInt32(v) != 0) k.SetValue("ShowBanner", 0, RegistryValueKind.DWord);
                    }
                }
                if (changed)
                {
                    List<string> lines = new List<string>();
                    foreach (KeyValuePair<string, string> kv in saved) lines.Add(kv.Key + "\t" + kv.Value);
                    File.WriteAllLines(bannerFile, lines.ToArray());
                }
            }
        }
        catch { }
    }

    static void BannersRestore()
    {
        if (bannerFile == null || !File.Exists(bannerFile)) return;
        Dictionary<string, string> saved = LoadBanners();
        using (RegistryKey root = Registry.CurrentUser.OpenSubKey(NotifKey, true))
        {
            if (root == null) return;
            foreach (KeyValuePair<string, string> kv in saved)
            {
                try
                {
                    using (RegistryKey k = root.OpenSubKey(kv.Key, true))
                    {
                        if (k == null) continue;
                        if (kv.Value == "absent") k.DeleteValue("ShowBanner", false);
                        else k.SetValue("ShowBanner", int.Parse(kv.Value), RegistryValueKind.DWord);
                    }
                }
                catch { }
            }
        }
        try { File.Delete(bannerFile); } catch { }
    }
}
