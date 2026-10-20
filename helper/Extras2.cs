// tinybar-helper: input languages through TSF, and connecting paired Bluetooth audio devices.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Win32;

[StructLayout(LayoutKind.Sequential)]
struct TFPROFILE
{
    public uint type; public ushort langid; public Guid clsid; public Guid profile; public Guid catid;
    public IntPtr hklSubstitute; public uint caps; public IntPtr hkl; public uint flags;
}

[ComImport, Guid("71C6E74D-0F28-11D8-A82A-00065B84435C"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEnumTfInputProcessorProfiles
{
    [PreserveSig] int Clone(out IntPtr e);
    [PreserveSig] int Next(uint n, out TFPROFILE p, out uint fetched);
    [PreserveSig] int Reset();
    [PreserveSig] int Skip(uint n);
}

[ComImport, Guid("71C6E74C-0F28-11D8-A82A-00065B84435C"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ITfInputProcessorProfileMgr
{
    [PreserveSig] int ActivateProfile(uint type, ushort langid, ref Guid clsid, ref Guid profile, IntPtr hkl, uint flags);
    [PreserveSig] int DeactivateProfile(uint type, ushort langid, ref Guid clsid, ref Guid profile, IntPtr hkl, uint flags);
    [PreserveSig] int GetProfile(uint type, ushort langid, ref Guid clsid, ref Guid profile, IntPtr hkl, out TFPROFILE p);
    [PreserveSig] int EnumProfiles(ushort langid, out IEnumTfInputProcessorProfiles e);
}

[ComImport, Guid("1F02B6C5-7842-4EE6-8A0B-9A24183A95CA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ITfInputProcessorProfiles
{
    [PreserveSig] int Register(IntPtr a);
    [PreserveSig] int Unregister(IntPtr a);
    [PreserveSig] int AddLanguageProfile(IntPtr a, ushort b, IntPtr c, IntPtr d, uint e, IntPtr f, uint g, uint h);
    [PreserveSig] int RemoveLanguageProfile(IntPtr a, ushort b, IntPtr c);
    [PreserveSig] int EnumInputProcessorInfo(out IntPtr e);
    [PreserveSig] int GetDefaultLanguageProfile(ushort a, IntPtr b, IntPtr c, IntPtr d);
    [PreserveSig] int SetDefaultLanguageProfile(ushort a, IntPtr b, IntPtr c);
    [PreserveSig] int ActivateLanguageProfile(IntPtr a, ushort b, IntPtr c);
    [PreserveSig] int GetActiveLanguageProfile(IntPtr a, out ushort b, out Guid c);
    [PreserveSig] int GetLanguageProfileDescription(ref Guid clsid, ushort langid, ref Guid profile, [MarshalAs(UnmanagedType.BStr)] out string desc);
}

[ComImport, Guid("33C53A50-F456-4884-B049-85FD643ECFED")]
class TfInputProcessorProfiles { }

[ComImport, Guid("2A07407E-6497-4A18-9787-32F79BD0D98F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeviceTopology
{
    [PreserveSig] int GetConnectorCount(out uint n);
    [PreserveSig] int GetConnector(uint i, out IConnector c);
}

[ComImport, Guid("9c2c4058-23f5-41de-877a-df3af236a09e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IConnector
{
    [PreserveSig] int GetConnType(out int t);
    [PreserveSig] int GetDataFlow(out int f);
    [PreserveSig] int ConnectTo(IntPtr c);
    [PreserveSig] int Disconnect();
    [PreserveSig] int IsConnected([MarshalAs(UnmanagedType.Bool)] out bool b);
    [PreserveSig] int GetConnectedTo(out IntPtr c);
    [PreserveSig] int GetConnectorIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetDeviceIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id);
}

[StructLayout(LayoutKind.Sequential)]
struct KSPROPERTY { public Guid Set; public uint Id; public uint Flags; }

[ComImport, Guid("28F54685-06FD-11D2-B27A-00A0C9223196"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IKsControl
{
    [PreserveSig] int KsProperty(ref KSPROPERTY p, uint plen, IntPtr data, uint dlen, out uint returned);
}

static partial class Program
{
    // false = leave the Win key to Windows (Start menu), true = tinybar takes the tap
    static volatile bool winHijack = true;
    [DllImport("powrprof.dll")] static extern bool SetSuspendState(bool hibernate, bool force, bool wakeupEventsDisabled);

    // ================================================================ languages (TSF)
    // Windows lists input methods as TSF profiles: plain keyboard layouts (type 2) and
    // text services like Microsoft Pinyin (type 1). Switching uses both TSF and the classic
    // WM_INPUTLANGCHANGEREQUEST, because each one reliably covers the case the other misses.
    class LangProfile { public uint type; public ushort langid; public Guid clsid, profile; public long hkl; public string name, sub, shortName, key; }
    static List<LangProfile> langProfiles = new List<LangProfile>();
    static int langProfilesAt = 0;

    static string LayoutText(long hkl)
    {
        try
        {
            int hi = (int)((hkl >> 16) & 0xffff);
            string klid = null;
            if ((hi & 0xf000) == 0xf000)
            {
                int layoutId = hi & 0x0fff;
                using (RegistryKey root = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Keyboard Layouts"))
                    foreach (string k in root.GetSubKeyNames())
                        using (RegistryKey s = root.OpenSubKey(k))
                        {
                            object id = s.GetValue("Layout Id");
                            if (id != null && Convert.ToInt32(id.ToString(), 16) == layoutId) { klid = k; break; }
                        }
            }
            else klid = hi.ToString("X8");
            if (klid == null) return "";
            using (RegistryKey k = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Keyboard Layouts\" + klid))
                return k == null ? "" : Convert.ToString(k.GetValue("Layout Text"));
        }
        catch { return ""; }
    }

    static void LoadLangProfiles()
    {
        List<LangProfile> list = new List<LangProfile>();
        try
        {
            object o = new TfInputProcessorProfiles();
            ITfInputProcessorProfileMgr mgr = (ITfInputProcessorProfileMgr)o;
            ITfInputProcessorProfiles names = (ITfInputProcessorProfiles)o;
            IEnumTfInputProcessorProfiles e;
            if (mgr.EnumProfiles(0, out e) == 0 && e != null)
            {
                TFPROFILE p; uint got;
                while (e.Next(1, out p, out got) == 0 && got == 1)
                {
                    if ((p.flags & 2) == 0 || p.langid == 0) continue; // enabled, real languages only
                    if (p.type == 1 && p.catid != new Guid("34745C63-B2F0-4784-8B67-5E12C8701A31")) continue; // keyboard TIPs only
                    LangProfile l = new LangProfile();
                    l.type = p.type; l.langid = p.langid; l.clsid = p.clsid; l.profile = p.profile; l.hkl = p.hkl.ToInt64();
                    l.shortName = "?"; l.name = "Language " + p.langid.ToString("X4");
                    try
                    {
                        CultureInfo c = new CultureInfo(p.langid);
                        l.shortName = c.ThreeLetterISOLanguageName.ToUpperInvariant();
                        l.name = c.DisplayName;
                    }
                    catch { }
                    if (p.type == 1)
                    {
                        string desc;
                        Guid cl = p.clsid, pr = p.profile;
                        l.sub = names.GetLanguageProfileDescription(ref cl, p.langid, ref pr, out desc) == 0 ? desc : "Input method";
                    }
                    else l.sub = LayoutText(l.hkl) + " keyboard";
                    l.key = p.type + ":" + p.langid.ToString("X4") + ":" + p.clsid + ":" + p.profile + ":" + l.hkl.ToString("X");
                    list.Add(l);
                }
            }
        }
        catch (Exception ex) { Emit("error", new Dictionary<string, object> { { "msg", "tsf: " + ex.Message } }); }
        if (list.Count > 0) langProfiles = list;
        langProfilesAt = Environment.TickCount;
    }

    // which profile is live in the window the user is typing in
    static LangProfile CurrentLang()
    {
        IntPtr target = lastExternalFg != IntPtr.Zero ? lastExternalFg : Native.GetForegroundWindow();
        uint pid;
        uint tid = Native.GetWindowThreadProcessId(target, out pid);
        long hkl = NX.GetKeyboardLayout(tid).ToInt64();
        ushort lid = (ushort)(hkl & 0xffff);
        LangProfile best = null;
        foreach (LangProfile l in langProfiles)
        {
            if (l.langid != lid) continue;
            if (l.type == 2 && l.hkl == hkl) return l;
            if (best == null) best = l;
        }
        return best;
    }

    static void PollLang()
    {
        if (langProfiles.Count == 0 || Environment.TickCount - langProfilesAt > 30000) LoadLangProfiles();
        LangProfile cur = CurrentLang();
        List<object> list = new List<object>();
        foreach (LangProfile l in langProfiles)
        {
            Dictionary<string, object> x = new Dictionary<string, object>();
            x["key"] = l.key; x["short"] = l.shortName; x["name"] = l.name; x["sub"] = l.sub; x["cur"] = l == cur;
            list.Add(x);
        }
        Dictionary<string, object> d = new Dictionary<string, object>();
        d["list"] = list; d["cur"] = cur != null ? cur.shortName : "";
        string js = Json.Serialize(d);
        if (js != lastLangJson) { lastLangJson = js; Emit("lang", d); }
    }

    static void SetLangKey(string key)
    {
        LangProfile t = null;
        foreach (LangProfile l in langProfiles) if (l.key == key) t = l;
        if (t == null) return;
        IntPtr target = lastExternalFg != IntPtr.Zero ? lastExternalFg : Native.GetForegroundWindow();
        long hkl = t.type == 2 ? t.hkl : (((long)t.langid << 16) | t.langid);
        for (int attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                ITfInputProcessorProfileMgr mgr = (ITfInputProcessorProfileMgr)new TfInputProcessorProfiles();
                Guid c = t.clsid, p = t.profile;
                mgr.ActivateProfile(t.type, t.langid, ref c, ref p, new IntPtr(t.hkl), 0x20000000 | 0x4); // for the session
            }
            catch { }
            Native.PostMessage(target, 0x0050, IntPtr.Zero, new IntPtr(hkl)); // WM_INPUTLANGCHANGEREQUEST
            System.Threading.Thread.Sleep(120);
            LangProfile now = CurrentLang();
            if (now != null && now.langid == t.langid) break;
        }
        lastLangJson = "";
        PollLang();
    }

    // ================================================================ Bluetooth audio connect / disconnect
    // There is no public "connect this paired device" API. For audio devices the Bluetooth audio
    // driver exposes one-shot reconnect/disconnect properties on its kernel-streaming filter;
    // this is the same route Windows' own quick settings and tools like ToothTray take.
    static readonly Guid KSPROPSETID_BtAudio = new Guid("7FA06C40-B8F6-4C7E-8556-E8C33A12E54D");

    static bool BtAudio(string name, bool connect)
    {
        bool ok = false;
        try
        {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            IMMDeviceCollection col;
            if (en.EnumAudioEndpoints(2, 0xF, out col) != 0 || col == null) return false;
            uint n; col.GetCount(out n);
            HashSet<string> done = new HashSet<string>();
            for (uint i = 0; i < n; i++)
            {
                IMMDevice d;
                if (col.Item(i, out d) != 0 || d == null) continue;
                string fname = FriendlyName(d);
                if (fname.IndexOf(name, StringComparison.OrdinalIgnoreCase) < 0) continue;
                Guid tiid = typeof(IDeviceTopology).GUID;
                object o;
                if (d.Activate(ref tiid, 23, IntPtr.Zero, out o) != 0 || o == null) continue;
                IConnector c;
                if (((IDeviceTopology)o).GetConnector(0, out c) != 0 || c == null) continue;
                string filterId;
                if (c.GetDeviceIdConnectedTo(out filterId) != 0 || string.IsNullOrEmpty(filterId) || !done.Add(filterId)) continue;
                IMMDevice filter;
                if (en.GetDevice(filterId, out filter) != 0 || filter == null) continue;
                Guid kiid = typeof(IKsControl).GUID;
                object ko;
                if (filter.Activate(ref kiid, 23, IntPtr.Zero, out ko) != 0 || ko == null) continue;
                KSPROPERTY p = new KSPROPERTY();
                p.Set = KSPROPSETID_BtAudio; p.Id = connect ? 0u : 1u; p.Flags = 1; // ONESHOT_RECONNECT / DISCONNECT, GET
                uint ret;
                int hr = ((IKsControl)ko).KsProperty(ref p, (uint)Marshal.SizeOf(typeof(KSPROPERTY)), IntPtr.Zero, 0, out ret);
                if (hr == 0) ok = true;
            }
        }
        catch (Exception ex) { Emit("error", new Dictionary<string, object> { { "msg", "bt: " + ex.Message } }); }
        return ok;
    }

    // which paired names have an audio endpoint we can drive
    static List<object> BtAudioNames()
    {
        List<object> l = new List<object>();
        try
        {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            IMMDeviceCollection col;
            if (en.EnumAudioEndpoints(2, 0xF, out col) != 0 || col == null) return l;
            uint n; col.GetCount(out n);
            for (uint i = 0; i < n; i++)
            {
                IMMDevice d;
                if (col.Item(i, out d) != 0 || d == null) continue;
                string id; d.GetId(out id);
                int st; d.GetState(out st);
                Dictionary<string, object> x = new Dictionary<string, object>();
                x["name"] = FriendlyName(d); x["state"] = st;
                l.Add(x);
            }
        }
        catch { }
        return l;
    }

    static bool HandleExtra2(string cmd, Dictionary<string, object> m)
    {
        switch (cmd)
        {
            case "shellExec":
                {
                    string path = Str(m, "path"), verb = Str(m, "verb"), args = Str(m, "args");
                    // own thread: a UAC prompt or Open-with dialog must never stall the helper
                    System.Threading.Thread t = new System.Threading.Thread(delegate()
                    {
                        try
                        {
                            System.Diagnostics.ProcessStartInfo psi = new System.Diagnostics.ProcessStartInfo(path);
                            psi.UseShellExecute = true;
                            if (verb.Length > 0) psi.Verb = verb;
                            if (args.Length > 0) psi.Arguments = args;
                            System.Diagnostics.Process.Start(psi);
                        }
                        catch { } // cancelled UAC prompt lands here
                    });
                    t.SetApartmentState(System.Threading.ApartmentState.STA);
                    t.IsBackground = true;
                    t.Start();
                    return true;
                }
            case "winHijack": winHijack = m.ContainsKey("on") && Convert.ToBoolean(m["on"]); winDown = false; return true;
            case "sleep": System.Threading.ThreadPool.QueueUserWorkItem(delegate { SetSuspendState(false, false, false); }); return true;
            case "keys":
                {
                    string combo = Str(m, "combo");
                    byte second = combo == "desktop" ? (byte)0x44 : combo == "taskview" ? (byte)0x09 : (byte)0;
                    if (second == 0) return true;
                    // our own hook ignores injected keys, so the real Windows shell sees a genuine Win+D / Win+Tab
                    Native.keybd_event(0x5B, 0, 0, UIntPtr.Zero);
                    Native.keybd_event(second, 0, 0, UIntPtr.Zero);
                    Native.keybd_event(second, 0, 2, UIntPtr.Zero);
                    Native.keybd_event(0x5B, 0, 2, UIntPtr.Zero);
                    return true;
                }
            case "sysclose": { IntPtr h = new IntPtr(Lng(m, "hwnd")); Native.PostMessage(h, 0x0112, new IntPtr(0xF060), IntPtr.Zero); return true; } // WM_SYSCOMMAND, SC_CLOSE
            case "setLangKey": { string key = Str(m, "key"); ui.BeginInvoke(new Action(delegate { SetLangKey(key); })); return true; }
            case "btAudio":
                {
                    long id = Lng(m, "id"); string name = Str(m, "name"); bool connect = Str(m, "action") != "disconnect";
                    ui.BeginInvoke(new Action(delegate
                    {
                        bool ok = BtAudio(name, connect);
                        Dictionary<string, object> r = new Dictionary<string, object>();
                        r["id"] = id; r["ok"] = ok;
                        Emit("btAudio", r);
                    }));
                    return true;
                }
            case "audioEndpoints":
                {
                    long id = Lng(m, "id");
                    ui.BeginInvoke(new Action(delegate
                    {
                        Dictionary<string, object> r = new Dictionary<string, object>();
                        r["id"] = id; r["list"] = BtAudioNames();
                        Emit("audioEndpoints", r);
                    }));
                    return true;
                }
        }
        return false;
    }
}
