// wispy-helper: native side of wispy. Talks JSON lines over stdin/stdout.
// Built with the in-box .NET Framework csc (C# 5), so no modern syntax in here.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Data.OleDb;
using System.Drawing;
using System.Diagnostics;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Native
{
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx, cy; }
    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLL { public uint vk; public uint scan; public uint flags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)]
    public struct APPBARDATA { public uint cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
    [StructLayout(LayoutKind.Sequential)]
    public struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }

    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int id, HookProc cb, IntPtr mod, uint thread);
    [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObj, int idChild, uint thread, uint time);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc cb, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern int GetApplicationUserModelId(IntPtr process, ref uint len, StringBuilder id);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr h, int idx);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder sb, ref int size);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
    [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    public static extern int SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr h);
    [DllImport("gdi32.dll")] public static extern int GetObject(IntPtr h, int size, ref BITMAP bm);
}

[ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItemImageFactory
{
    [PreserveSig] int GetImage(Native.SIZE size, int flags, out IntPtr hbm);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorCom { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.Interface)] out object iface);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume
{
    [PreserveSig] int RegisterControlChangeNotify(IntPtr p);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
    [PreserveSig] int GetChannelCount(out uint n);
    [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid ctx);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint ch, float level, ref Guid ctx);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
    [PreserveSig] int GetChannelVolumeLevel(uint ch, out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

static partial class Program
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object OutLock = new object();
    static StreamWriter stdout;
    static Control ui;
    static string selfExe = "";

    // hooks
    static Native.HookProc kbProc = KbHook;
    static Native.HookProc msProc = MsHook;
    static IntPtr kbHook = IntPtr.Zero, msHook = IntPtr.Zero;
    static int fullPolls = 0;
    static bool winDown, otherPressed, acceptInjected;
    static readonly UIntPtr MaskTag = new UIntPtr(0x7B1B);

    // taskbar
    static volatile bool taskbarHidden;
    static int origBarState = -1;
    static string stateFile;

    // volume + window list change tracking
    static float lastVol = -1;
    static bool lastMuted;
    static string lastWindowsJson = "";
    static readonly Dictionary<uint, string> exeCache = new Dictionary<uint, string>();

    static readonly Dictionary<string, string> nameCache = new Dictionary<string, string>();
    static readonly BlockingCollection<Action> iconQueue = new BlockingCollection<Action>();

    static readonly string[] SkipClasses = new string[] {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow", "XamlExplorerHostIslandWindow"
    };
    static readonly string[] SkipExes = new string[] {
        "applicationframehost.exe", "textinputhost.exe", "searchhost.exe", "startmenuexperiencehost.exe",
        "shellexperiencehost.exe", "lockapp.exe", "systemsettings.exe_"
    };

    [STAThread]
    static void Main(string[] args)
    {
        try { Native.SetProcessDPIAware(); } catch { }
        for (int i = 0; i < args.Length; i++)
            if (args[i] == "--self" && i + 1 < args.Length) selfExe = args[i + 1].ToLowerInvariant();
        for (int i = 0; i < args.Length; i++) if (args[i] == "--test-injected") acceptInjected = true;

        stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        stdout.AutoFlush = true;
        string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        string dir = Path.Combine(appData, "wispy");
        try { Directory.CreateDirectory(dir); } catch { }
        stateFile = Path.Combine(dir, "taskbar-state.txt");

        AppDomain.CurrentDomain.ProcessExit += delegate { RestoreTaskbar(); };
        AppDomain.CurrentDomain.UnhandledException += delegate { RestoreTaskbar(); };

        ui = new Control();
        IntPtr unused = ui.Handle; // force handle creation on this (UI) thread

        // the hooks live on their own thread: if the UI thread is busy (window polling, icons), Windows must never
        // have to wait on them, or it skips the key (the Start menu opens) or drops the hook for good
        Thread hooker = new Thread(HookLoop);
        hooker.SetApartmentState(ApartmentState.STA);
        hooker.IsBackground = true;
        hooker.Start();

        Thread worker = new Thread(IconWorker);
        worker.SetApartmentState(ApartmentState.STA);
        worker.IsBackground = true;
        worker.Start();

        Thread reader = new Thread(ReadLoop);
        reader.IsBackground = true;
        reader.Start();

        System.Windows.Forms.Timer winTimer = new System.Windows.Forms.Timer();
        winTimer.Interval = 600;
        winTimer.Tick += delegate { PollWindows(); };
        winTimer.Start();

        // the poll above is only the safety net: windows opening, closing, minimising or taking the foreground
        // ask for an immediate (throttled) poll, so the dock follows what you do within a frame or two
        soonTimer = new System.Windows.Forms.Timer();
        soonTimer.Interval = 80;
        soonTimer.Tick += delegate { soonTimer.Stop(); PollWindows(); };
        winEvProc = OnWinEvent;
        Native.SetWinEventHook(0x0003, 0x0003, IntPtr.Zero, winEvProc, 0, 0, 0);   // foreground changed
        Native.SetWinEventHook(0x0016, 0x0017, IntPtr.Zero, winEvProc, 0, 0, 0);   // minimise start / end
        Native.SetWinEventHook(0x8001, 0x8003, IntPtr.Zero, winEvProc, 0, 0, 0);   // destroyed, shown, hidden

        System.Windows.Forms.Timer volTimer = new System.Windows.Forms.Timer();
        volTimer.Interval = 350;
        volTimer.Tick += delegate { PollVolume(); };
        volTimer.Start();

        // Windows re-shows an auto-hidden taskbar the moment the cursor touches the screen edge,
        // so keep slapping it back down at ~80Hz; one frame of it is all anyone could ever see
        Thread guard = new Thread(delegate()
        {
            while (true)
            {
                try { if (taskbarHidden) ApplyHidden(); } catch { }
                Thread.Sleep(12);
            }
        });
        guard.IsBackground = true;
        guard.Start();

        StartExtras();
        Emit("ready", null);
        Application.Run();
        RestoreTaskbar();
        if (kbHook != IntPtr.Zero) Native.UnhookWindowsHookEx(kbHook);
        if (msHook != IntPtr.Zero) Native.UnhookWindowsHookEx(msHook);
        Environment.Exit(0);
    }

    // ---------- io ----------
    static void Emit(string ev, Dictionary<string, object> d)
    {
        if (d == null) d = new Dictionary<string, object>();
        d["ev"] = ev;
        string s = Json.Serialize(d);
        lock (OutLock)
        {
            try { stdout.WriteLine(s); } catch { }
        }
    }

    static void ReadLoop()
    {
        StreamReader r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        try
        {
            while ((line = r.ReadLine()) != null)
            {
                Dictionary<string, object> m = null;
                try { m = Json.DeserializeObject(line) as Dictionary<string, object>; } catch { }
                if (m == null) continue;
                Dictionary<string, object> mm = m;
                try { Handle(mm); } catch (Exception e) { Emit("error", new Dictionary<string, object> { { "msg", e.Message } }); }
            }
        }
        catch { }
        // parent went away: put everything back and leave
        try { ui.BeginInvoke(new Action(delegate { RestoreTaskbar(); Application.ExitThread(); })); }
        catch { RestoreTaskbar(); Environment.Exit(0); }
    }

    static string Str(Dictionary<string, object> m, string k)
    {
        object o; return m.TryGetValue(k, out o) && o != null ? Convert.ToString(o) : "";
    }
    static long Lng(Dictionary<string, object> m, string k)
    {
        object o; return m.TryGetValue(k, out o) && o != null ? Convert.ToInt64(Convert.ToDouble(o)) : 0;
    }

    static void Handle(Dictionary<string, object> m)
    {
        string cmd = Str(m, "cmd");
        switch (cmd)
        {
            case "hideTaskbar": ui.BeginInvoke(new Action(HideTaskbar)); break;
            case "restoreTaskbar": ui.BeginInvoke(new Action(RestoreTaskbar)); break;
            case "focus": { IntPtr h = new IntPtr(Lng(m, "hwnd")); ui.BeginInvoke(new Action(delegate { Focus(h); })); break; }
            case "minimize": { IntPtr h = new IntPtr(Lng(m, "hwnd")); Native.ShowWindow(h, 6); break; }
            case "close": { IntPtr h = new IntPtr(Lng(m, "hwnd")); Native.PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); break; }
            case "fg":
                {
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["id"] = Lng(m, "id"); d["hwnd"] = Native.GetForegroundWindow().ToInt64();
                    Emit("fg", d); break;
                }
            case "volume":
                {
                    float level = m.ContainsKey("level") ? (float)Convert.ToDouble(m["level"]) : -1f;
                    int muted = m.ContainsKey("muted") ? (Convert.ToBoolean(m["muted"]) ? 1 : 0) : -1;
                    ui.BeginInvoke(new Action(delegate { SetVolume(level, muted); }));
                    break;
                }
            case "icon":
                {
                    long id = Lng(m, "id"); string path = Str(m, "path"); int size = (int)Lng(m, "size"); string outp = Str(m, "out"); long hw = Lng(m, "hwnd");
                    iconQueue.Add(delegate { DoIcon(id, path, size, outp, hw); });
                    break;
                }
            case "search":
                {
                    long id = Lng(m, "id"); string q = Str(m, "q");
                    ThreadPool.QueueUserWorkItem(delegate { DoSearch(id, q); });
                    break;
                }
            case "quit": ui.BeginInvoke(new Action(delegate { RestoreTaskbar(); Application.ExitThread(); })); break;
            default: HandleExtra(cmd, m); break;
        }
    }

    static System.Windows.Forms.Timer soonTimer;
    static HashSet<long> knownWindows = new HashSet<long>();
    static Native.WinEventProc winEvProc;
    static void OnWinEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObj, int idChild, uint thread, uint time)
    {
        if (ev >= 0x8000)
        {
            // created / destroyed / shown / hidden: only top-level windows the dock could care about, or the system is
            // flooded with tooltips, menus and animation frames
            if (idObj != 0 || idChild != 0 || hwnd == IntPtr.Zero || Native.GetParent(hwnd) != IntPtr.Zero) return;
            long id = hwnd.ToInt64();
            bool known = knownWindows.Contains(id);
            if (ev == 0x8001 || ev == 0x8003) { if (!known) return; }        // destroy / hide: only windows we listed
            else
            {
                if (known) return;                                           // show of one we already list changes nothing
                if (Native.GetWindowTextLength(hwnd) == 0) return;
                long ex = Native.GetWindowLongPtr(hwnd, -20).ToInt64();
                if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return;         // tool windows
            }
        }
        if (soonTimer != null && !soonTimer.Enabled) soonTimer.Start();
    }

    // ---------- hooks ----------
    static void InstallHooks()
    {
        IntPtr mod = Native.GetModuleHandle(null);
        if (kbHook != IntPtr.Zero) Native.UnhookWindowsHookEx(kbHook);
        if (msHook != IntPtr.Zero) Native.UnhookWindowsHookEx(msHook);
        kbHook = Native.SetWindowsHookEx(13, kbProc, mod, 0);
        msHook = Native.SetWindowsHookEx(14, msProc, mod, 0);
    }

    static void HookLoop()
    {
        InstallHooks();
        // Windows silently removes a low-level hook that ever answers too slowly; putting it back is cheap
        System.Windows.Forms.Timer refresh = new System.Windows.Forms.Timer();
        refresh.Interval = 30000;
        refresh.Tick += delegate { InstallHooks(); };
        refresh.Start();
        Application.Run();
    }

    static IntPtr KbHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            try
            {
                Native.KBDLL k = (Native.KBDLL)Marshal.PtrToStructure(lParam, typeof(Native.KBDLL));
                bool ours = k.extra == (IntPtr)0x7B1B; // our own mask key
                if (winHijack && !ours && ((k.flags & 0x10) == 0 || acceptInjected))
                {
                    int msg = wParam.ToInt32();
                    bool down = msg == 0x100 || msg == 0x104;
                    bool up = msg == 0x101 || msg == 0x105;
                    bool isWin = k.vk == 0x5B || k.vk == 0x5C;
                    if (isWin)
                    {
                        if (down) { if (!winDown) { winDown = true; otherPressed = false; } }
                        else if (up && winDown)
                        {
                            winDown = false;
                            if (!otherPressed)
                            {
                                // unassigned key between Win down and up cancels the Start menu
                                Native.keybd_event(0xE8, 0, 0, MaskTag);
                                Native.keybd_event(0xE8, 0, 2, MaskTag);
                                Dictionary<string, object> d = new Dictionary<string, object>();
                                d["fg"] = Native.GetForegroundWindow().ToInt64();
                                Emit("win", d);
                            }
                        }
                    }
                    else if (down && winDown) otherPressed = true;
                }
            }
            catch { }
        }
        return Native.CallNextHookEx(kbHook, code, wParam, lParam);
    }

    static IntPtr MsHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            try
            {
                int msg = wParam.ToInt32();
                if (msg == 0x201 || msg == 0x204 || msg == 0x207)
                {
                    if (winDown) otherPressed = true;
                    Dictionary<string, object> md = new Dictionary<string, object>();
                    md["t"] = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; // same clock as Date.now()
                    Emit("mouse", md);
                }
            }
            catch { }
        }
        return Native.CallNextHookEx(msHook, code, wParam, lParam);
    }

    // ---------- taskbar ----------
    static List<IntPtr> TrayWindows()
    {
        List<IntPtr> l = new List<IntPtr>();
        IntPtr main = ExplorerTray();
        if (main != IntPtr.Zero) l.Add(main);
        IntPtr sec = IntPtr.Zero;
        while ((sec = Native.FindWindowEx(IntPtr.Zero, sec, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) l.Add(sec);
        return l;
    }

    static int BarState(IntPtr tray, int set)
    {
        Native.APPBARDATA d = new Native.APPBARDATA();
        d.cbSize = (uint)Marshal.SizeOf(typeof(Native.APPBARDATA));
        d.hWnd = tray;
        if (set >= 0) { d.lParam = new IntPtr(set); Native.SHAppBarMessage(0xA, ref d); return set; }
        return (int)Native.SHAppBarMessage(0x4, ref d).ToUInt32();
    }

    static void HideTaskbar()
    {
        IntPtr tray = ExplorerTray();
        if (origBarState < 0)
        {
            int stored = -1;
            try { if (File.Exists(stateFile)) stored = int.Parse(File.ReadAllText(stateFile).Trim()); } catch { }
            if (stored >= 0) origBarState = stored; // an earlier unclean exit left autohide on
            else
            {
                origBarState = BarState(tray, -1);
                try { File.WriteAllText(stateFile, origBarState.ToString()); } catch { }
            }
        }
        BarState(tray, origBarState | 1);
        taskbarHidden = true;
        ApplyHidden();
    }

    static void ApplyHidden()
    {
        foreach (IntPtr h in TrayWindows())
            if (Native.IsWindowVisible(h)) Native.ShowWindow(h, 0);
    }

    static void RestoreTaskbar()
    {
        try { BannersRestore(); } catch { }
        try { StopTrayHost(); } catch { }
        if (!taskbarHidden && origBarState < 0) return;
        taskbarHidden = false;
        try
        {
            foreach (IntPtr h in TrayWindows()) Native.ShowWindow(h, 8);
            IntPtr tray = ExplorerTray();
            if (origBarState >= 0) BarState(tray, origBarState);
            origBarState = -1;
            try { File.Delete(stateFile); } catch { }
        }
        catch { }
    }

    // ---------- windows ----------
    static string ExeOf(uint pid)
    {
        string s;
        if (exeCache.TryGetValue(pid, out s)) return s;
        s = "";
        IntPtr h = Native.OpenProcess(0x1000, false, pid);
        if (h != IntPtr.Zero)
        {
            StringBuilder sb = new StringBuilder(1024);
            int n = sb.Capacity;
            if (Native.QueryFullProcessImageName(h, 0, sb, ref n)) s = sb.ToString();
            Native.CloseHandle(h);
        }
        if (s.Length > 0) exeCache[pid] = s;
        return s;
    }

    static string AumidOf(uint pid)
    {
        string s = "";
        IntPtr h = Native.OpenProcess(0x1000, false, pid);
        if (h != IntPtr.Zero)
        {
            try
            {
                uint len = 256;
                StringBuilder sb = new StringBuilder(256);
                if (Native.GetApplicationUserModelId(h, ref len, sb) == 0) s = sb.ToString().ToLowerInvariant();
            }
            catch { }
            Native.CloseHandle(h);
        }
        return s;
    }

    static string NameOf(string exe, string title)
    {
        string n;
        if (nameCache.TryGetValue(exe, out n)) return n;
        n = "";
        try { n = FileVersionInfo.GetVersionInfo(exe).FileDescription; } catch { }
        if (n == null) n = "";
        n = n.Trim();
        // helper processes describe themselves, not the app the user sees
        if (n.Length == 0 || n.ToLowerInvariant().Contains("helper") || n.ToLowerInvariant().Contains("host")) n = "";
        nameCache[exe] = n;
        return n;
    }

    static void PollWindows()
    {
        List<object> list = new List<object>();
        Native.EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            if (!Native.IsWindowVisible(h)) return true;
            int cloaked;
            Native.DwmGetWindowAttribute(h, 14, out cloaked, 4);
            if (cloaked != 0) return true;
            long ex = Native.GetWindowLongPtr(h, -20).ToInt64();
            bool tool = (ex & 0x80) != 0, app = (ex & 0x40000) != 0;
            if (tool && !app) return true;
            if (Native.GetWindow(h, 4) != IntPtr.Zero && !app) return true;
            if ((ex & 0x08000000) != 0 && !app) return true;
            int len = Native.GetWindowTextLength(h);
            if (len == 0) return true;
            StringBuilder cls = new StringBuilder(128);
            Native.GetClassName(h, cls, 128);
            string c = cls.ToString();
            for (int i = 0; i < SkipClasses.Length; i++) if (c == SkipClasses[i]) return true;
            uint pid; Native.GetWindowThreadProcessId(h, out pid);
            string exe = ExeOf(pid);
            if (exe.Length == 0) return true;
            string low = exe.ToLowerInvariant();
            string file = Path.GetFileName(low);
            string aumid = "";
            if (file == "applicationframehost.exe")
            {
                // Settings, Calculator and other UWP apps live inside Windows' app frame: the real app is the process
                // that owns the CoreWindow inside it
                uint appPid = 0;
                uint framePid = pid;
                Native.EnumChildWindows(h, delegate(IntPtr ch, IntPtr lp)
                {
                    StringBuilder cc = new StringBuilder(64);
                    Native.GetClassName(ch, cc, 64);
                    if (cc.ToString() != "Windows.UI.Core.CoreWindow") return true;
                    uint p2; Native.GetWindowThreadProcessId(ch, out p2);
                    if (p2 == framePid) return true;
                    appPid = p2;
                    return false;
                }, IntPtr.Zero);
                if (appPid == 0) return true;
                exe = ExeOf(appPid);
                if (exe.Length == 0) return true;
                pid = appPid;
                low = exe.ToLowerInvariant();
                file = Path.GetFileName(low);
                aumid = AumidOf(appPid);
            }
            if (low == selfExe) return true;
            for (int i = 0; i < SkipExes.Length; i++) if (file == SkipExes[i]) return true;
            StringBuilder t = new StringBuilder(len + 2);
            Native.GetWindowText(h, t, len + 2);
            Dictionary<string, object> w = new Dictionary<string, object>();
            w["hwnd"] = h.ToInt64();
            w["exe"] = exe;
            w["title"] = t.ToString();
            w["name"] = NameOf(exe, t.ToString());
            w["pid"] = (long)pid;
            if (aumid.Length > 0) w["aumid"] = aumid;
            w["min"] = Native.IsIconic(h);
            list.Add(w);
            return true;
        }, IntPtr.Zero);

        HashSet<long> seen = new HashSet<long>();
        foreach (object o in list) seen.Add(Convert.ToInt64(((Dictionary<string, object>)o)["hwnd"]));
        knownWindows = seen;
        IntPtr fg = Native.GetForegroundWindow();
        bool full = false;
        if (fg != IntPtr.Zero)
        {
            try
            {
                Native.RECT r; Native.GetWindowRect(fg, out r);
                Native.MONITORINFO mi = new Native.MONITORINFO();
                mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFO));
                IntPtr mon = Native.MonitorFromWindow(fg, 2);
                StringBuilder cls = new StringBuilder(128);
                Native.GetClassName(fg, cls, 128);
                string c = cls.ToString();
                long style = Native.GetWindowLongPtr(fg, -16).ToInt64();
                // a maximised window also fills the screen now that the taskbar is hidden: not fullscreen
                if (Native.GetMonitorInfo(mon, ref mi) && (style & 0xC00000) != 0xC00000 && (style & 0x01000000) == 0 &&
                    c != "Progman" && c != "WorkerW" && c != "Shell_TrayWnd" &&
                    r.left <= mi.rcMonitor.left && r.top <= mi.rcMonitor.top &&
                    r.right >= mi.rcMonitor.right && r.bottom >= mi.rcMonitor.bottom) full = true;
            }
            catch { }
        }
        // a window opening can cover the screen for a moment: only call it fullscreen once it has stayed that way
        fullPolls = full ? fullPolls + 1 : 0;
        full = fullPolls >= 2;
        Dictionary<string, object> d = new Dictionary<string, object>();
        try { PollExtras(fg); } catch { }
        d["list"] = list; d["fg"] = fg.ToInt64(); d["full"] = full;
        string js = Json.Serialize(d);
        if (js != lastWindowsJson) { lastWindowsJson = js; Emit("windows", d); }
    }

    static void Focus(IntPtr h)
    {
        if (Native.IsIconic(h)) Native.ShowWindow(h, 9);
        // Windows only lets the process that last received input take the foreground: a tap of an unassigned key,
        // tagged so our own hook ignores it, counts as that input (this is what keeps "click to bring it up" reliable)
        Native.keybd_event(0xE8, 0, 0, MaskTag);
        Native.keybd_event(0xE8, 0, 2, MaskTag);
        IntPtr fg = Native.GetForegroundWindow();
        uint pid;
        uint fgThread = Native.GetWindowThreadProcessId(fg, out pid);
        uint me = Native.GetCurrentThreadId();
        bool att = fgThread != 0 && fgThread != me && Native.AttachThreadInput(me, fgThread, true);
        Native.BringWindowToTop(h);
        Native.SetForegroundWindow(h);
        if (att) Native.AttachThreadInput(me, fgThread, false);
        if (Native.GetForegroundWindow() != h) Native.SwitchToThisWindow(h, true);
    }

    // ---------- volume ----------
    static IAudioEndpointVolume Endpoint()
    {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        IMMDevice dev;
        if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return null;
        Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        object o;
        if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return null;
        return (IAudioEndpointVolume)o;
    }

    static void PollVolume()
    {
        try
        {
            IAudioEndpointVolume v = Endpoint();
            if (v == null) return;
            float lvl; bool muted;
            v.GetMasterVolumeLevelScalar(out lvl);
            v.GetMute(out muted);
            if (Math.Abs(lvl - lastVol) > 0.004f || muted != lastMuted)
            {
                lastVol = lvl; lastMuted = muted;
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["level"] = Math.Round(lvl * 100.0); d["muted"] = muted;
                Emit("volume", d);
            }
        }
        catch { }
    }

    static void SetVolume(float level, int muted)
    {
        try
        {
            IAudioEndpointVolume v = Endpoint();
            if (v == null) return;
            Guid ctx = Guid.Empty;
            if (level >= 0) v.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, level / 100f)), ref ctx);
            if (muted >= 0) v.SetMute(muted == 1, ref ctx);
            PollVolume();
        }
        catch { }
    }

    // ---------- icons ----------
    static void IconWorker()
    {
        foreach (Action a in iconQueue.GetConsumingEnumerable())
        {
            try { a(); } catch { }
        }
    }

    // Store-packaged exes carry no useful icon of their own; ask the window instead
    static bool WindowIcon(long hwnd, string outPath)
    {
        try
        {
            IntPtr h = new IntPtr(hwnd), res;
            IntPtr ic = IntPtr.Zero;
            if (Native.SendMessageTimeout(h, 0x7F, new IntPtr(1), IntPtr.Zero, 2, 300, out res) != IntPtr.Zero) ic = res;
            if (ic == IntPtr.Zero) ic = Native.GetClassLongPtr(h, -14);
            if (ic == IntPtr.Zero) return false;
            using (Icon icon = Icon.FromHandle(ic))
            using (Bitmap bmp = icon.ToBitmap())
            {
                string dir = Path.GetDirectoryName(outPath);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                bmp.Save(outPath, ImageFormat.Png);
                return true;
            }
        }
        catch { return false; }
    }

    static void DoIcon(long id, string path, int size, string outPath, long hwnd)
    {
        bool ok = false;
        IntPtr hbm = IntPtr.Zero;
        if (hwnd != 0 && path.IndexOf("\\WindowsApps\\", StringComparison.OrdinalIgnoreCase) >= 0 && WindowIcon(hwnd, outPath))
        {
            Dictionary<string, object> dd = new Dictionary<string, object>();
            dd["id"] = id; dd["ok"] = true; dd["out"] = outPath;
            Emit("icon", dd);
            return;
        }
        try
        {
            Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
            object o;
            if (Native.SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out o) == 0)
            {
                IShellItemImageFactory f = (IShellItemImageFactory)o;
                Native.SIZE s; s.cx = size; s.cy = size;
                if (f.GetImage(s, 0x4 | 0x1, out hbm) == 0 && hbm != IntPtr.Zero)
                {
                    Native.BITMAP bm = new Native.BITMAP();
                    Native.GetObject(hbm, Marshal.SizeOf(typeof(Native.BITMAP)), ref bm);
                    int w = bm.bmWidth, h = Math.Abs(bm.bmHeight);
                    using (Bitmap dst = new Bitmap(w, h, PixelFormat.Format32bppArgb))
                    {
                        BitmapData bd = dst.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                        byte[] row = new byte[w * 4];
                        for (int y = 0; y < h; y++)
                        {
                            IntPtr src = new IntPtr(bm.bmBits.ToInt64() + (long)(h - 1 - y) * bm.bmWidthBytes);
                            Marshal.Copy(src, row, 0, w * 4);
                            Marshal.Copy(row, 0, new IntPtr(bd.Scan0.ToInt64() + (long)y * bd.Stride), w * 4);
                        }
                        dst.UnlockBits(bd);
                        string dir = Path.GetDirectoryName(outPath);
                        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                        dst.Save(outPath, ImageFormat.Png);
                        ok = true;
                    }
                }
            }
        }
        catch { }
        if (hbm != IntPtr.Zero) Native.DeleteObject(hbm);
        Dictionary<string, object> d = new Dictionary<string, object>();
        d["id"] = id; d["ok"] = ok; d["out"] = outPath;
        Emit("icon", d);
    }

    // ---------- windows search index ----------
    static void DoSearch(long id, string q)
    {
        List<object> items = new List<object>();
        try
        {
            string safe = q.Replace("'", "''").Replace("%", "").Replace("[", "").Replace("_", "");
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).Replace('\\', '/');
            string sql = "SELECT TOP 40 System.ItemName, System.ItemPathDisplay, System.ItemType, System.DateModified " +
                "FROM SystemIndex WHERE SCOPE='file:" + profile + "' AND System.ItemName LIKE '%" + safe + "%' " +
                "AND System.ItemPathDisplay NOT LIKE '%\\AppData\\%' AND System.ItemPathDisplay NOT LIKE '%\\node_modules\\%' " +
                "AND System.ItemPathDisplay NOT LIKE '%\\.git\\%' AND System.ItemPathDisplay NOT LIKE '%\\.claude\\%' " +
                "AND System.ItemPathDisplay NOT LIKE '%\\site-packages\\%' AND System.ItemPathDisplay NOT LIKE '%\\.vscode\\%' AND System.ItemPathDisplay NOT LIKE '%\\.gradle\\%' " +
                "AND System.ItemPathDisplay NOT LIKE '%\\.cache\\%' AND System.ItemPathDisplay NOT LIKE '%\\.npm\\%' AND System.ItemPathDisplay NOT LIKE '%\\stubs\\%' AND System.ItemPathDisplay NOT LIKE '%\\.nuget\\%' " +
                "AND System.ItemType <> '.lnk' AND System.ItemType <> '.url' " +
                "ORDER BY System.DateModified DESC";
            using (OleDbConnection conn = new OleDbConnection("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';"))
            {
                conn.Open();
                using (OleDbCommand cmd = new OleDbCommand(sql, conn))
                using (OleDbDataReader r = cmd.ExecuteReader())
                {
                    while (r.Read())
                    {
                        Dictionary<string, object> it = new Dictionary<string, object>();
                        it["name"] = Convert.ToString(r[0]);
                        it["path"] = Convert.ToString(r[1]);
                        it["type"] = Convert.ToString(r[2]);
                        items.Add(it);
                    }
                }
            }
        }
        catch { }
        Dictionary<string, object> d = new Dictionary<string, object>();
        d["id"] = id; d["items"] = items;
        Emit("search", d);
    }
}
