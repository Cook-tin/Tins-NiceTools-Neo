using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

namespace NiceToolsSetup
{
    internal static class Program
    {
        private const string AppName = "NiceTools";
        private const string Version = "1.4.0";
        private const string PayloadResource = "NiceToolsPayload";
        internal static bool Silent = false;

        private static void Log(string message)
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(Path.GetTempPath(), "nicetools-setup.log"),
                    DateTime.Now.ToString("s") + " " + message + Environment.NewLine);
            }
            catch { }
        }

        private static string DefaultDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs",
                    AppName);
            }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            bool silent = false;
            bool noLaunch = false;
            bool noDesktop = false;
            string target = DefaultDir;
            foreach (string arg in args)
            {
                if (string.Equals(arg, "/S", StringComparison.OrdinalIgnoreCase)) silent = true;
                else if (string.Equals(arg, "/NOLAUNCH", StringComparison.OrdinalIgnoreCase)) noLaunch = true;
                else if (string.Equals(arg, "/NODESKTOP", StringComparison.OrdinalIgnoreCase)) noDesktop = true;
                else if (arg.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) target = arg.Substring(3).Trim('"');
            }
            if (silent)
            {
                Silent = true;
                Install(target, !noDesktop, !noLaunch);
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }

        internal static bool Install(string installDir, bool desktopShortcut, bool launch)
        {
            try
            {
                Log("start install " + installDir);
                installDir = Path.GetFullPath(installDir);
                KillApps();
                string payload = Path.Combine(Path.GetTempPath(), "nicetools-payload-" + Guid.NewGuid().ToString("N") + ".zip");
                using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource))
                {
                    if (input == null) throw new InvalidOperationException("安装包损坏：找不到应用数据。");
                    using (FileStream output = File.Create(payload)) input.CopyTo(output);
                }
                Log("payload " + new FileInfo(payload).Length);
                if (Directory.Exists(installDir)) Directory.Delete(installDir, true);
                Directory.CreateDirectory(installDir);
                ZipFile.ExtractToDirectory(payload, installDir);
                Log("extracted");
                try { File.Delete(payload); } catch { }

                string exe = Path.Combine(installDir, "NiceTools.exe");
                CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk"), exe, installDir);
                Log("desktop shortcut");
                string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
                Directory.CreateDirectory(programs);
                CreateShortcut(Path.Combine(programs, AppName + ".lnk"), exe, installDir);
                Log("start menu shortcut");

                string uninstaller = Path.Combine(installDir, "NiceToolsUninstall.exe");
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\NiceTools"))
                {
                    if (key != null)
                    {
                        key.SetValue("DisplayName", "NiceTools");
                        key.SetValue("DisplayVersion", Version);
                        key.SetValue("Publisher", "NiceTools");
                        key.SetValue("InstallLocation", installDir);
                        key.SetValue("DisplayIcon", exe);
                        key.SetValue("UninstallString", "\"" + uninstaller + "\"");
                        key.SetValue("QuietUninstallString", "\"" + uninstaller + "\" /S");
                        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    }
                }
                if (!desktopShortcut)
                {
                    try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk")); } catch { }
                }
                if (launch) Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = installDir, UseShellExecute = true });
                Log("done");
                return true;
            }
            catch (Exception ex)
            {
                Log("FAILED " + ex);
                if (!Silent)
                {
                    MessageBox.Show("安装失败：\r\n" + ex.Message, "NiceTools 安装", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                return false;
            }
        }

        internal static void KillApps()
        {
            string[] names = { "NiceTools", "NiceToolsCore" };
            foreach (string name in names)
            {
                foreach (Process p in Process.GetProcessesByName(name))
                {
                    try { p.Kill(); p.WaitForExit(4000); } catch { }
                }
            }
        }

        private static void CreateShortcut(string path, string target, string workdir)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workdir });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { target + ",0" });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }

        internal static string VersionText { get { return Version; } }
    }

    internal sealed class SetupForm : Form
    {
        private readonly TextBox pathBox;
        private readonly CheckBox desktopBox;
        private readonly CheckBox launchBox;
        private readonly Button installButton;
        private readonly Label status;
        private readonly ProgressBar progress;

        internal SetupForm()
        {
            Text = "NiceTools " + Program.VersionText + " 安装";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new System.Drawing.Size(560, 300);
            Font = new System.Drawing.Font("Microsoft YaHei UI", 9F);
            BackColor = System.Drawing.Color.White;

            Label title = new Label();
            title.Text = "NiceTools";
            title.Font = new System.Drawing.Font("Microsoft YaHei UI", 22F, System.Drawing.FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new System.Drawing.Point(28, 20);
            Controls.Add(title);

            Label sub = new Label();
            sub.Text = "视频裁剪 · 解析转换 · LiteNX 引擎";
            sub.ForeColor = System.Drawing.Color.Gray;
            sub.AutoSize = true;
            sub.Location = new System.Drawing.Point(32, 70);
            Controls.Add(sub);

            Label label = new Label();
            label.Text = "安装位置";
            label.AutoSize = true;
            label.Location = new System.Drawing.Point(30, 116);
            Controls.Add(label);

            pathBox = new TextBox();
            pathBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "NiceTools");
            pathBox.Location = new System.Drawing.Point(32, 138);
            pathBox.Width = 410;
            Controls.Add(pathBox);

            Button browse = new Button();
            browse.Text = "浏览…";
            browse.Location = new System.Drawing.Point(450, 136);
            browse.Size = new System.Drawing.Size(78, 26);
            browse.Click += delegate
            {
                using (FolderBrowserDialog dialog = new FolderBrowserDialog())
                {
                    dialog.Description = "选择 NiceTools 安装文件夹";
                    if (dialog.ShowDialog(this) == DialogResult.OK) pathBox.Text = dialog.SelectedPath;
                }
            };
            Controls.Add(browse);

            desktopBox = new CheckBox();
            desktopBox.Text = "创建桌面快捷方式";
            desktopBox.Checked = true;
            desktopBox.AutoSize = true;
            desktopBox.Location = new System.Drawing.Point(32, 178);
            Controls.Add(desktopBox);

            launchBox = new CheckBox();
            launchBox.Text = "安装完成后启动 NiceTools";
            launchBox.Checked = true;
            launchBox.AutoSize = true;
            launchBox.Location = new System.Drawing.Point(210, 178);
            Controls.Add(launchBox);

            status = new Label();
            status.Text = "将安装到当前用户目录，无需管理员权限。";
            status.ForeColor = System.Drawing.Color.Gray;
            status.AutoSize = true;
            status.Location = new System.Drawing.Point(32, 211);
            Controls.Add(status);

            progress = new ProgressBar();
            progress.Location = new System.Drawing.Point(32, 236);
            progress.Size = new System.Drawing.Size(496, 8);
            progress.Style = ProgressBarStyle.Marquee;
            progress.Visible = false;
            Controls.Add(progress);

            installButton = new Button();
            installButton.Text = "安装 NiceTools";
            installButton.Location = new System.Drawing.Point(360, 252);
            installButton.Size = new System.Drawing.Size(168, 34);
            installButton.BackColor = System.Drawing.Color.Black;
            installButton.ForeColor = System.Drawing.Color.White;
            installButton.FlatStyle = FlatStyle.Flat;
            installButton.FlatAppearance.BorderSize = 0;
            installButton.Click += delegate { DoInstall(); };
            Controls.Add(installButton);

            Button cancel = new Button();
            cancel.Text = "取消";
            cancel.Location = new System.Drawing.Point(278, 252);
            cancel.Size = new System.Drawing.Size(72, 34);
            cancel.FlatStyle = FlatStyle.Flat;
            cancel.Click += delegate { Close(); };
            Controls.Add(cancel);
        }

        private void DoInstall()
        {
            installButton.Enabled = false;
            progress.Visible = true;
            status.Text = "正在安装，请稍候…";
            Application.DoEvents();
            bool ok = Program.Install(pathBox.Text.Trim(), desktopBox.Checked, launchBox.Checked);
            if (ok)
            {
                MessageBox.Show("NiceTools 已安装完成。", "NiceTools", MessageBoxButtons.OK, MessageBoxIcon.Information);
                Close();
            }
            else
            {
                installButton.Enabled = true;
                progress.Visible = false;
                status.Text = "安装失败，请检查路径和权限。";
            }
        }
    }
}
