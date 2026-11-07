using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Threading;
using System.Windows.Forms;

namespace NiceToolsUpdater
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Dictionary<string, string> map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                string key = args[i];
                if (key.StartsWith("--") && i + 1 < args.Length)
                {
                    map[key.Substring(2)] = args[++i];
                }
            }
            string dir = map.ContainsKey("dir") ? map["dir"] : AppDomain.CurrentDomain.BaseDirectory;
            string zip = map.ContainsKey("zip") ? map["zip"] : "";
            string exe = map.ContainsKey("exe") ? map["exe"] : Path.Combine(dir, "NiceTools.exe");
            int pid = 0;
            if (map.ContainsKey("pid")) int.TryParse(map["pid"], out pid);

            try
            {
                if (pid > 0)
                {
                    try
                    {
                        Process process = Process.GetProcessById(pid);
                        process.WaitForExit(60000);
                    }
                    catch { }
                }
                Thread.Sleep(800);
                if (string.IsNullOrEmpty(zip) || !File.Exists(zip))
                    throw new InvalidOperationException("找不到更新包：" + zip);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                string temp = Path.Combine(Path.GetTempPath(), "nicetools-update-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(temp);
                ZipFile.ExtractToDirectory(zip, temp);
                CopyDirectory(temp, dir);
                try { Directory.Delete(temp, true); } catch { }
                if (File.Exists(exe))
                {
                    ProcessStartInfo info = new ProcessStartInfo(exe);
                    info.WorkingDirectory = dir;
                    info.UseShellExecute = true;
                    string updateArgs = "--updated";
                    if (!string.IsNullOrEmpty(zip))
                    {
                        updateArgs += " --update-zip \"" + zip.Replace("\"", "\\\"") + "\"";
                    }
                    info.Arguments = updateArgs;
                    Process.Start(info);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("更新失败：\r\n" + ex.Message, "NiceTools 更新", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        private static void CopyDirectory(string source, string target)
        {
            Directory.CreateDirectory(target);
            foreach (string file in Directory.GetFiles(source))
            {
                if (string.Equals(Path.GetFileName(file), "NiceToolsUpdater.exe", StringComparison.OrdinalIgnoreCase))
                    continue;
                if (string.Equals(Path.GetFileName(file), "NiceToolsUpdater2.exe", StringComparison.OrdinalIgnoreCase))
                    continue;
                File.Copy(file, Path.Combine(target, Path.GetFileName(file)), true);
            }
            foreach (string sub in Directory.GetDirectories(source))
            {
                CopyDirectory(sub, Path.Combine(target, Path.GetFileName(sub)));
            }
        }
    }
}
