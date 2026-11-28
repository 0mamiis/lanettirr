using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace LanettirrTrayApp
{
    internal sealed class ServiceDef
    {
        public string Name;
        public string Label;
        public int Port;
        public bool Ready;
    }

    internal static class NativeMethods
    {
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr LoadLibrary(string lpFileName);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool SetDllDirectory(string lpPathName);
    }

    internal static class Program
    {
        private const string AppId = "Lanettirr_SingleInstance_Mutex_v1";
        internal const string ShowEventName = "Lanettirr_ShowControlWindow_Event_v1";

        [STAThread]
        private static void Main(string[] args)
        {
            bool createdNew;
            using (var mutex = new Mutex(true, AppId, out createdNew))
            {
                if (!createdNew)
                {
                    try
                    {
                        using (var ev = EventWaitHandle.OpenExisting(ShowEventName))
                        {
                            ev.Set();
                        }
                    }
                    catch { }
                    return;
                }

                string rootDir = ResolveRepoRoot();
                BootstrapWebView2Dependencies(rootDir);
                RunApp(args, rootDir);
            }
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static void RunApp(string[] args, string rootDir)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayContext(args, rootDir));
        }

        private static void BootstrapWebView2Dependencies(string rootDir)
        {
            var asm = Assembly.GetExecutingAssembly();

            AppDomain.CurrentDomain.AssemblyResolve += (sender, e) =>
            {
                string shortName = new AssemblyName(e.Name).Name;
                string resName = null;
                if (string.Equals(shortName, "Microsoft.Web.WebView2.Core", StringComparison.OrdinalIgnoreCase))
                    resName = "Microsoft.Web.WebView2.Core.dll";
                else if (string.Equals(shortName, "Microsoft.Web.WebView2.WinForms", StringComparison.OrdinalIgnoreCase))
                    resName = "Microsoft.Web.WebView2.WinForms.dll";

                if (resName == null) return null;
                using (var s = asm.GetManifestResourceStream(resName))
                {
                    if (s == null) return null;
                    byte[] bytes = new byte[s.Length];
                    int read = 0;
                    while (read < bytes.Length)
                    {
                        int n = s.Read(bytes, read, bytes.Length - read);
                        if (n <= 0) break;
                        read += n;
                    }
                    return Assembly.Load(bytes);
                }
            };

            try
            {
                string nativeDir = Path.Combine(rootDir, ".runtime", "webview2");
                Directory.CreateDirectory(nativeDir);
                string loaderPath = Path.Combine(nativeDir, "WebView2Loader.dll");
                using (var s = asm.GetManifestResourceStream("WebView2Loader.dll"))
                {
                    if (s != null)
                    {
                        bool needWrite = !File.Exists(loaderPath) || new FileInfo(loaderPath).Length != s.Length;
                        if (needWrite)
                        {
                            using (var fs = new FileStream(loaderPath, FileMode.Create, FileAccess.Write, FileShare.Read))
                            {
                                s.CopyTo(fs);
                            }
                        }
                    }
                }
                NativeMethods.SetDllDirectory(nativeDir);
                if (File.Exists(loaderPath)) NativeMethods.LoadLibrary(loaderPath);
            }
            catch { }
        }

        internal static string ResolveRepoRoot()
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            if (File.Exists(Path.Combine(dir, "scripts", "start-all.ps1"))) return dir;
            string parent = Directory.GetParent(dir) != null ? Directory.GetParent(dir).FullName : dir;
            if (File.Exists(Path.Combine(parent, "scripts", "start-all.ps1"))) return parent;
            return dir;
        }
    }

    internal sealed class TrayContext : ApplicationContext
    {
        private readonly string _rootDir;
        private readonly string _version;
        private readonly List<ServiceDef> _services;
        private readonly int _megaPort;
        private readonly EventWaitHandle _showEvent;

        private readonly NotifyIcon _trayIcon;
        private readonly ContextMenuStrip _menu;
        private readonly ToolStripMenuItem _miHeader;
        private readonly ToolStripMenuItem _miStartup;
        private readonly MainAppForm _form;

        private readonly Icon _iconGreen;
        private readonly Icon _iconAmber;
        private readonly Icon _iconRed;

        private readonly System.Threading.Timer _pollTimer;
        private int _polling;
        private int _busy;
        private bool _notifiedReady;
        private bool _exiting;
        private Thread _signalThread;

        public TrayContext(string[] args, string rootDir)
        {
            _rootDir = rootDir;
            _version = ReadVersion(_rootDir);
            var ports = LoadEnvPorts(_rootDir);
            _megaPort = ports["MEGA_PORT"];

            _services = new List<ServiceDef>
            {
                new ServiceDef { Name = "cs-host", Label = "CloudStream Host", Port = ports["BB_PORT"] },
                new ServiceDef { Name = "egress", Label = "Egress Proxy", Port = ports["EGRESS_PORT"] },
                new ServiceDef { Name = "kraptor-bridge", Label = "Kraptor Bridge", Port = ports["BRIDGE_PORT"] },
                new ServiceDef { Name = "trhub", Label = "TR / EN Hub", Port = ports["HUB_PORT"] },
                new ServiceDef { Name = "mega-bridge", Label = "Lanettirr Ana Sunucu", Port = ports["MEGA_PORT"] },
            };

            _iconGreen = CreateBadgeIcon(Color.FromArgb(34, 197, 94));
            _iconAmber = CreateBadgeIcon(Color.FromArgb(245, 158, 11));
            _iconRed = CreateBadgeIcon(Color.FromArgb(239, 68, 68));

            _menu = new ContextMenuStrip();
            _menu.Renderer = new DarkMenuRenderer();
            _menu.ShowImageMargin = false;
            _menu.BackColor = Color.FromArgb(24, 24, 28);
            _menu.ForeColor = Color.FromArgb(240, 240, 245);

            _miHeader = new ToolStripMenuItem("Lanettirr v" + _version + " · Başlatılıyor...") { Enabled = false };
            _menu.Items.Add(_miHeader);
            _menu.Items.Add(new ToolStripSeparator());

            var miOpenCtrl = new ToolStripMenuItem("Lanettirr'i Aç", null, (s, e) => ShowMainWindow());
            miOpenCtrl.Font = new Font(miOpenCtrl.Font, FontStyle.Bold);
            _menu.Items.Add(miOpenCtrl);

            var miLinks = new ToolStripMenuItem("Nuvio / Stremio Linkleri");
            miLinks.DropDown.BackColor = Color.FromArgb(24, 24, 28);
            miLinks.DropDown.ForeColor = Color.FromArgb(240, 240, 245);
            miLinks.DropDown.Renderer = new DarkMenuRenderer();
            miLinks.DropDownItems.Add(new ToolStripMenuItem("Kopyala: Nuvio Addon + Katalog (/saved/manifest.json)", null, (s, e) => CopyUrl("/saved/manifest.json", "Nuvio Addon + Katalog linki")));
            miLinks.DropDownItems.Add(new ToolStripMenuItem("Kopyala: Nuvio Plugins (/saved/nuvio-repo/manifest.json)", null, (s, e) => CopyUrl("/saved/nuvio-repo/manifest.json", "Nuvio Plugins linki")));
            miLinks.DropDownItems.Add(new ToolStripMenuItem("Kopyala: Nuvio Rozetleri (/badges.json)", null, (s, e) => CopyUrl("/badges.json", "Rozet linki")));
            miLinks.DropDownItems.Add(new ToolStripMenuItem("Kopyala: CloudStream Repo (/saved/cs3/repo.json)", null, (s, e) => CopyUrl("/saved/cs3/repo.json", "CloudStream linki")));
            _menu.Items.Add(miLinks);

            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(new ToolStripMenuItem("Servisleri Yeniden Başlat", null, (s, e) => RestartServicesAsync()));
            _menu.Items.Add(new ToolStripMenuItem("Log Klasörünü Aç", null, (s, e) => OpenLogsFolder()));
            _menu.Items.Add(new ToolStripMenuItem("Masaüstüne Kısayol Oluştur", null, (s, e) => CreateDesktopShortcut()));

            _miStartup = new ToolStripMenuItem("Windows ile Başlat", null, (s, e) => ToggleStartup())
            {
                Checked = IsStartupEnabled(),
                CheckOnClick = false
            };
            _menu.Items.Add(_miStartup);

            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(new ToolStripMenuItem("Kapat (Servisleri Durdur)", null, (s, e) => ShutdownAndExit()));

            _trayIcon = new NotifyIcon
            {
                Icon = _iconAmber,
                Text = "Lanettirr · Başlatılıyor...",
                ContextMenuStrip = _menu,
                Visible = true,
            };
            _trayIcon.DoubleClick += (s, e) => ShowMainWindow();

            _form = new MainAppForm(this, _rootDir, _version, _services, _megaPort, _iconAmber);

            bool createdEv;
            _showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName, out createdEv);
            _signalThread = new Thread(ListenForShowSignal) { IsBackground = true };
            _signalThread.Start();

            bool startMinimized = Array.Exists(args ?? new string[0], a => string.Equals(a, "--tray", StringComparison.OrdinalIgnoreCase) || string.Equals(a, "--minimized", StringComparison.OrdinalIgnoreCase));
            if (!startMinimized)
            {
                ShowMainWindow();
            }

            StartServicesAsync();
            _pollTimer = new System.Threading.Timer(_ => PollServices(), null, 700, 2500);
        }

        private void ListenForShowSignal()
        {
            while (!_exiting)
            {
                try
                {
                    if (_showEvent.WaitOne(1000) && !_exiting)
                    {
                        BeginUi(() => ShowMainWindow());
                    }
                }
                catch { break; }
            }
        }

        private void BeginUi(Action act)
        {
            if (_exiting) return;
            try
            {
                if (_form != null && _form.IsHandleCreated)
                    _form.BeginInvoke(act);
                else
                    act();
            }
            catch { }
        }

        public void ShowMainWindow()
        {
            if (_exiting) return;
            if (!_form.Visible) _form.Show();
            if (_form.WindowState == FormWindowState.Minimized) _form.WindowState = FormWindowState.Normal;
            _form.Activate();
        }

        public void CopyUrl(string path, string label)
        {
            string url = "http://127.0.0.1:" + _megaPort + path;
            try
            {
                Clipboard.SetText(url);
                ShowBalloon("Panoya kopyalandı", label + ":\n" + url, ToolTipIcon.Info);
            }
            catch { }
        }

        public void OpenLogsFolder()
        {
            string dir = Path.Combine(_rootDir, ".runtime", "logs");
            try
            {
                Directory.CreateDirectory(dir);
                Process.Start(new ProcessStartInfo("explorer.exe", dir) { UseShellExecute = true });
            }
            catch { }
        }

        public void CreateDesktopShortcut()
        {
            try
            {
                string exePath = Application.ExecutablePath;
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string lnkPath = Path.Combine(desktop, "Lanettirr.lnk");
                string ps = "$ws = New-Object -ComObject WScript.Shell; " +
                            "$sc = $ws.CreateShortcut('" + EscapePs(lnkPath) + "'); " +
                            "$sc.TargetPath = '" + EscapePs(exePath) + "'; " +
                            "$sc.WorkingDirectory = '" + EscapePs(_rootDir) + "'; " +
                            "$sc.Description = 'Lanettirr VOD Hub'; " +
                            "$sc.Save()";
                RunHiddenPowerShellCommand(ps, 8000);
                ShowBalloon("Kısayol Oluşturuldu", "Masaüstüne Lanettirr kısayolu eklendi.", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                ShowBalloon("Kısayol Hatası", ex.Message, ToolTipIcon.Warning);
            }
        }

        private bool IsStartupEnabled()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false))
                {
                    var val = key != null ? key.GetValue("Lanettirr") as string : null;
                    return !string.IsNullOrEmpty(val);
                }
            }
            catch { return false; }
        }

        public void ToggleStartup()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key == null) return;
                    if (IsStartupEnabled())
                    {
                        key.DeleteValue("Lanettirr", false);
                        _miStartup.Checked = false;
                        ShowBalloon("Windows Başlangıcı", "Otomatik başlatma kapatıldı.", ToolTipIcon.Info);
                    }
                    else
                    {
                        key.SetValue("Lanettirr", "\"" + Application.ExecutablePath + "\" --tray");
                        _miStartup.Checked = true;
                        ShowBalloon("Windows Başlangıcı", "Bilgisayar açıldığında sistem tepsisinde başlayacak.", ToolTipIcon.Info);
                    }
                }
            }
            catch { }
        }

        public void StartServicesAsync()
        {
            if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return;
            _notifiedReady = false;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    RunHiddenScript(Path.Combine(_rootDir, "scripts", "start-all.ps1"), 120000);
                }
                finally
                {
                    Interlocked.Exchange(ref _busy, 0);
                    PollServices();
                }
            });
        }

        public void RestartServicesAsync()
        {
            if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return;
            _notifiedReady = false;
            BeginUi(() => _form.NotifyRestarting());
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    RunHiddenScript(Path.Combine(_rootDir, "scripts", "stop-all.ps1"), 30000);
                    Thread.Sleep(600);
                    RunHiddenScript(Path.Combine(_rootDir, "scripts", "start-all.ps1"), 120000);
                }
                finally
                {
                    Interlocked.Exchange(ref _busy, 0);
                    PollServices();
                }
            });
        }

        public void ShutdownAndExit()
        {
            if (_exiting) return;
            _exiting = true;
            try { _pollTimer.Dispose(); } catch { }
            BeginUi(() => _form.SetExitingState());
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    RunHiddenScript(Path.Combine(_rootDir, "scripts", "stop-all.ps1"), 30000);
                }
                catch { }
                BeginUi(() =>
                {
                    try { _trayIcon.Visible = false; } catch { }
                    try { _trayIcon.Dispose(); } catch { }
                    try { _showEvent.Set(); _showEvent.Dispose(); } catch { }
                    try { _form.ForceClose(); } catch { }
                    ExitThread();
                });
            });
        }

        private void PollServices()
        {
            if (_exiting) return;
            if (Interlocked.CompareExchange(ref _polling, 1, 0) != 0) return;
            try
            {
                int readyCount = 0;
                foreach (var svc in _services)
                {
                    svc.Ready = TestLocalPort(svc.Port);
                    if (svc.Ready) readyCount++;
                }

                bool megaUp = _services[_services.Count - 1].Ready;
                int provs = megaUp ? FetchProvidersCount(_megaPort) : -1;

                BeginUi(() =>
                {
                    if (_exiting) return;
                    bool allReady = readyCount == _services.Count;
                    string summary;
                    Icon targetIcon;
                    if (allReady)
                    {
                        targetIcon = _iconGreen;
                        summary = provs > 0
                            ? string.Format("Lanettirr v{0} · Hazır ({1}/5 · {2} kaynak)", _version, readyCount, provs)
                            : string.Format("Lanettirr v{0} · Hazır ({1}/5)", _version, readyCount);
                        if (!_notifiedReady)
                        {
                            _notifiedReady = true;
                            if (!_form.Visible)
                            {
                                ShowBalloon("Lanettirr Hazır", "Tüm servisler çalışıyor. Açmak için çift tıklayın.", ToolTipIcon.Info);
                            }
                        }
                    }
                    else if (readyCount > 0 || _busy == 1)
                    {
                        targetIcon = _iconAmber;
                        summary = string.Format("Lanettirr v{0} · Başlatılıyor ({1}/5)", _version, readyCount);
                    }
                    else
                    {
                        targetIcon = _iconRed;
                        summary = string.Format("Lanettirr v{0} · Durduruldu (0/5)", _version);
                    }

                    _trayIcon.Icon = targetIcon;
                    _trayIcon.Text = TruncateNotifyText(summary);
                    _miHeader.Text = summary;
                    _form.Icon = targetIcon;
                    _form.UpdateStatus(_services, readyCount, provs, _busy == 1, megaUp);
                });
            }
            catch { }
            finally
            {
                Interlocked.Exchange(ref _polling, 0);
            }
        }

        private void ShowBalloon(string title, string text, ToolTipIcon icon)
        {
            try
            {
                _trayIcon.BalloonTipTitle = title;
                _trayIcon.BalloonTipText = text;
                _trayIcon.BalloonTipIcon = icon;
                _trayIcon.ShowBalloonTip(2500);
            }
            catch { }
        }

        private static string TruncateNotifyText(string s)
        {
            if (string.IsNullOrEmpty(s)) return "Lanettirr";
            return s.Length <= 63 ? s : s.Substring(0, 60) + "...";
        }

        private static bool TestLocalPort(int port)
        {
            if (port <= 0) return false;
            try
            {
                using (var client = new TcpClient())
                {
                    var ar = client.BeginConnect("127.0.0.1", port, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(250) && client.Connected)
                    {
                        client.EndConnect(ar);
                        return true;
                    }
                }
            }
            catch { }
            return false;
        }

        private static int FetchProvidersCount(int megaPort)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + megaPort + "/health");
                req.Timeout = 1000;
                req.ReadWriteTimeout = 1000;
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    string json = sr.ReadToEnd();
                    var m = Regex.Match(json, "\"providersLoaded\"\\s*:\\s*(\\d+)");
                    if (m.Success) return int.Parse(m.Groups[1].Value);
                }
            }
            catch { }
            return -1;
        }

        private void RunHiddenScript(string scriptPath, int timeoutMs)
        {
            if (!File.Exists(scriptPath)) return;
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + scriptPath + "\"",
                WorkingDirectory = _rootDir,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using (var p = Process.Start(psi))
            {
                if (p != null) p.WaitForExit(timeoutMs);
            }
        }

        private void RunHiddenPowerShellCommand(string command, int timeoutMs)
        {
            string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(command ?? ""));
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand " + encoded,
                WorkingDirectory = _rootDir,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using (var p = Process.Start(psi))
            {
                if (p != null) p.WaitForExit(timeoutMs);
            }
        }

        private static string EscapePs(string s) { return (s ?? "").Replace("'", "''"); }

        private static string ReadVersion(string root)
        {
            try
            {
                string vf = Path.Combine(root, "VERSION");
                if (File.Exists(vf)) return File.ReadAllText(vf, Encoding.UTF8).Trim().TrimStart('v', 'V');
            }
            catch { }
            return "1.3.6";
        }

        private static Dictionary<string, int> LoadEnvPorts(string root)
        {
            var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
            {
                { "BB_PORT", 7200 },
                { "EGRESS_PORT", 7301 },
                { "BRIDGE_PORT", 7000 },
                { "HUB_PORT", 7100 },
                { "MEGA_PORT", 17410 },
            };
            try
            {
                string envPath = Path.Combine(root, ".env");
                if (File.Exists(envPath))
                {
                    foreach (string raw in File.ReadAllLines(envPath, Encoding.UTF8))
                    {
                        string line = raw.Trim();
                        if (string.IsNullOrEmpty(line) || line.StartsWith("#")) continue;
                        int idx = line.IndexOf('=');
                        if (idx <= 0) continue;
                        string k = line.Substring(0, idx).Trim();
                        string v = line.Substring(idx + 1).Trim().Trim('"', '\'');
                        int port;
                        if (map.ContainsKey(k) && int.TryParse(v, out port) && port > 0) map[k] = port;
                        if (k.Equals("PORT", StringComparison.OrdinalIgnoreCase) && int.TryParse(v, out port) && port > 0) map["MEGA_PORT"] = port;
                    }
                }
            }
            catch { }
            return map;
        }

        private static Icon CreateBadgeIcon(Color accent)
        {
            using (var bmp = new Bitmap(32, 32))
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using (var bg = new SolidBrush(Color.FromArgb(24, 24, 30)))
                using (var pen = new Pen(accent, 2.2f))
                {
                    g.FillEllipse(bg, 2, 2, 28, 28);
                    g.DrawEllipse(pen, 2, 2, 28, 28);
                }
                using (var font = new Font("Segoe UI", 15f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (var brush = new SolidBrush(Color.White))
                {
                    var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                    g.DrawString("L", font, brush, new RectangleF(1, 2, 30, 29), sf);
                }
                using (var dot = new SolidBrush(accent))
                {
                    g.FillEllipse(dot, 22, 21, 8, 8);
                }
                IntPtr hIcon = bmp.GetHicon();
                return (Icon)Icon.FromHandle(hIcon).Clone();
            }
        }
    }

    internal sealed class DarkMenuRenderer : ToolStripProfessionalRenderer
    {
        public DarkMenuRenderer() : base(new DarkColors()) { }
    }

    internal sealed class DarkColors : ProfessionalColorTable
    {
        public override Color MenuItemSelected { get { return Color.FromArgb(52, 52, 64); } }
        public override Color MenuItemBorder { get { return Color.FromArgb(72, 72, 88); } }
        public override Color MenuBorder { get { return Color.FromArgb(58, 58, 70); } }
        public override Color ToolStripDropDownBackground { get { return Color.FromArgb(24, 24, 28); } }
        public override Color SeparatorDark { get { return Color.FromArgb(52, 52, 62); } }
    }

    internal sealed class MainAppForm : Form
    {
        private readonly TrayContext _ctx;
        private readonly string _rootDir;
        private readonly string _version;
        private readonly int _megaPort;
        private readonly Panel _topBar;
        private readonly Label _lblBadge;
        private readonly Label _lblServices;
        private readonly FlowLayoutPanel _btnBar;
        private readonly WebView2 _webView;
        private bool _webReady;
        private bool _loadedConfigure;
        private bool _allowClose;

        public MainAppForm(TrayContext ctx, string rootDir, string version, List<ServiceDef> services, int megaPort, Icon initIcon)
        {
            _ctx = ctx;
            _rootDir = rootDir;
            _version = version;
            _megaPort = megaPort;

            Text = "Lanettirr · v" + version;
            if (initIcon != null) Icon = initIcon;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1180, 820);
            MinimumSize = new Size(880, 600);
            BackColor = Color.FromArgb(16, 16, 16);
            ForeColor = Color.FromArgb(241, 240, 235);
            Font = new Font("Segoe UI", 9.5f);

            _topBar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 46,
                BackColor = Color.FromArgb(22, 22, 22),
                Padding = new Padding(14, 7, 14, 7),
            };
            _topBar.Paint += (s, e) =>
            {
                using (var p = new Pen(Color.FromArgb(44, 44, 44)))
                    e.Graphics.DrawLine(p, 0, _topBar.Height - 1, _topBar.Width, _topBar.Height - 1);
            };

            _lblBadge = new Label
            {
                Text = "● Başlatılıyor (0/5)",
                AutoSize = true,
                Location = new Point(14, 13),
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(255, 77, 0),
            };
            _topBar.Controls.Add(_lblBadge);

            _lblServices = new Label
            {
                Text = "",
                AutoSize = true,
                Location = new Point(210, 14),
                Font = new Font("Segoe UI", 8.5f),
                ForeColor = Color.FromArgb(145, 144, 138),
            };
            _topBar.Controls.Add(_lblServices);

            _btnBar = new FlowLayoutPanel
            {
                Dock = DockStyle.Right,
                AutoSize = true,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Padding = new Padding(0, 1, 0, 0),
                BackColor = Color.Transparent,
            };

            var btnReload = MakeBarBtn("Yenile", Color.FromArgb(36, 36, 36));
            btnReload.Click += (s, e) => ReloadConfigure();

            var btnRestart = MakeBarBtn("Yeniden Başlat", Color.FromArgb(36, 36, 36));
            btnRestart.Click += (s, e) => _ctx.RestartServicesAsync();

            var btnShortcut = MakeBarBtn("Masaüstü Kısayolu", Color.FromArgb(36, 36, 36));
            btnShortcut.Click += (s, e) => _ctx.CreateDesktopShortcut();

            var btnHide = MakeBarBtn("Tepsiye Küçült", Color.FromArgb(46, 46, 46));
            btnHide.Click += (s, e) => Hide();

            var btnQuit = MakeBarBtn("Durdur ve Çık", Color.FromArgb(210, 52, 52));
            btnQuit.Click += (s, e) => _ctx.ShutdownAndExit();

            _btnBar.Controls.Add(btnReload);
            _btnBar.Controls.Add(btnRestart);
            _btnBar.Controls.Add(btnShortcut);
            _btnBar.Controls.Add(btnHide);
            _btnBar.Controls.Add(btnQuit);
            _topBar.Controls.Add(_btnBar);

            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(16, 16, 16),
            };

            Controls.Add(_webView);
            Controls.Add(_topBar);

            Load += async (s, e) => await InitWebViewAsync(services);
        }

        private static Button MakeBarBtn(string text, Color back)
        {
            var b = new Button
            {
                Text = text,
                AutoSize = true,
                MinimumSize = new Size(0, 29),
                Padding = new Padding(8, 0, 8, 0),
                Margin = new Padding(6, 0, 0, 0),
                FlatStyle = FlatStyle.Flat,
                BackColor = back,
                ForeColor = Color.White,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }

        private async System.Threading.Tasks.Task InitWebViewAsync(List<ServiceDef> services)
        {
            try
            {
                string userDataDir = Path.Combine(_rootDir, ".runtime", "webview2-userdata");
                Directory.CreateDirectory(userDataDir);
                var env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
                await _webView.EnsureCoreWebView2Async(env);
                _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                _webView.CoreWebView2.NewWindowRequested += (s, args) =>
                {
                    try
                    {
                        string uri = args.Uri ?? "";
                        if (uri.StartsWith("http://127.0.0.1:" + _megaPort, StringComparison.OrdinalIgnoreCase))
                        {
                            args.Handled = true;
                            _webView.CoreWebView2.Navigate(uri);
                        }
                        else if (uri.StartsWith("http://") || uri.StartsWith("https://") || uri.StartsWith("stremio://") || uri.StartsWith("cloudstreamrepo://"))
                        {
                            args.Handled = true;
                            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
                        }
                    }
                    catch { }
                };
                _webReady = true;
                ShowSplashHtml(services, "Servisler başlatılıyor...");
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Edge WebView2 başlatılamadı:\n" + ex.Message + "\n\nTarayıcıdan http://127.0.0.1:" + _megaPort + "/configure açabilirsiniz.",
                    "Lanettirr",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
            }
        }

        private void ShowSplashHtml(List<ServiceDef> services, string subtitle)
        {
            if (!_webReady || _webView.CoreWebView2 == null) return;
            var rows = new StringBuilder();
            foreach (var s in services)
            {
                string badge = s.Ready ? "<span class='ok'>HAZIR</span>" : "<span class='wait'>BEKLİYOR</span>";
                rows.Append("<div class='row'><span>" + EscapeHtml(s.Label) + " <small>(:" + s.Port + ")</small></span>" + badge + "</div>");
            }
            string html = "<!doctype html><html><head><meta charset='utf-8'><style>" +
                "body{margin:0;background:#101010;background-image:radial-gradient(#242424 1px,transparent 1px);background-size:16px 16px;color:#f1f0eb;font-family:'Segoe UI Variable Text','Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}" +
                ".card{width:460px;background:#161616;border:1px solid #2c2c2c;border-radius:6px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.6)}" +
                "h1{margin:0 0 6px;font-family:'Bahnschrift','Segoe UI',sans-serif;font-size:20px;color:#f1f0eb;letter-spacing:.06em}p{margin:0 0 18px;color:#91908a;font-size:13px}" +
                ".row{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#1d1d1d;border:1px solid #2c2c2c;border-radius:5px;margin-bottom:8px;font-size:13px}" +
                ".row small{color:#787772;font-family:'Cascadia Mono',Consolas,monospace}.ok{color:#46c077;font-weight:700;font-family:'Cascadia Mono',Consolas,monospace;font-size:11px}.wait{color:#ff4d00;font-weight:700;font-family:'Cascadia Mono',Consolas,monospace;font-size:11px}" +
                "</style></head><body><div class='card'><h1>LANETTIRR // MK-" + EscapeHtml(_version) + "</h1><p>" + EscapeHtml(subtitle) + "</p>" +
                rows + "</div></body></html>";
            _webView.CoreWebView2.NavigateToString(html);
        }

        private static string EscapeHtml(string s)
        {
            return (s ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
        }

        public void ReloadConfigure()
        {
            if (!_webReady || _webView.CoreWebView2 == null) return;
            string target = "http://127.0.0.1:" + _megaPort + "/configure";
            _loadedConfigure = true;
            _webView.CoreWebView2.Navigate(target);
        }

        public void NotifyRestarting()
        {
            _loadedConfigure = false;
            _lblBadge.Text = "● Yeniden başlatılıyor...";
            _lblBadge.ForeColor = Color.FromArgb(224, 159, 62);
        }

        public void SetExitingState()
        {
            _lblBadge.Text = "● Servisler durduruluyor...";
            _lblBadge.ForeColor = Color.FromArgb(217, 83, 79);
        }

        public void UpdateStatus(List<ServiceDef> services, int readyCount, int providersLoaded, bool busy, bool megaUp)
        {
            if (readyCount == services.Count)
            {
                _lblBadge.Text = providersLoaded > 0
                    ? string.Format("● Hazır ({0}/5 · {1} kaynak)", readyCount, providersLoaded)
                    : string.Format("● Hazır ({0}/5)", readyCount);
                _lblBadge.ForeColor = Color.FromArgb(78, 173, 115);
            }
            else if (busy || readyCount > 0)
            {
                _lblBadge.Text = string.Format("● Başlatılıyor ({0}/5)", readyCount);
                _lblBadge.ForeColor = Color.FromArgb(224, 159, 62);
            }
            else
            {
                _lblBadge.Text = "● Kapalı (0/5)";
                _lblBadge.ForeColor = Color.FromArgb(217, 83, 79);
            }

            if (megaUp && _webReady && _webView.CoreWebView2 != null && !_loadedConfigure)
            {
                _loadedConfigure = true;
                _webView.CoreWebView2.Navigate("http://127.0.0.1:" + _megaPort + "/configure");
            }
            else if (!megaUp && _webReady && _webView.CoreWebView2 != null)
            {
                if (_loadedConfigure) _loadedConfigure = false;
                ShowSplashHtml(services, busy ? "Servisler başlatılıyor, lütfen bekleyin..." : "Servisler bekleniyor...");
            }
        }

        public void ForceClose()
        {
            _allowClose = true;
            Close();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!_allowClose && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                return;
            }
            base.OnFormClosing(e);
        }
    }
}
