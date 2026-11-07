using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace NiceToolsUninstall
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool silent = false;
            foreach (string arg in args)
            {
                if (string.Equals(arg, "/S", StringComparison.OrdinalIgnoreCase)) silent = true;
            }
            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (!silent)
            {
                DialogResult result = MessageBox.Show(
                    "确定卸载 NiceTools？\r\n\r\n软件文件会被删除，个人媒体文件和设置不会被删除。",
                    "卸载 NiceTools",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (result != DialogResult.Yes) return;
            }
            KillApps();
            string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "NiceTools.lnk");
            string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "NiceTools");
            try { File.Delete(desktop); } catch { }
            try { if (Directory.Exists(programs)) Directory.Delete(programs, true); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\NiceTools", false); } catch { }
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(
                    "cmd.exe",
                    "/c timeout /t 2 >nul & rmdir /s /q \"" + dir + "\"");
                info.CreateNoWindow = true;
                info.UseShellExecute = false;
                Process.Start(info);
            }
            catch { }
        }

        private static void KillApps()
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
    }
}
