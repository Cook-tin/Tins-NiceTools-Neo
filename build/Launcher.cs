using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("NiceTools Neo")]
[assembly: AssemblyDescription("NiceTools Neo - lightweight video toolkit")]
[assembly: AssemblyProduct("NiceTools Neo")]
[assembly: AssemblyCompany("Tin")]
[assembly: AssemblyCopyright("MIT License")]
[assembly: AssemblyVersion("1.5.3.0")]
[assembly: AssemblyFileVersion("1.5.3.0")]

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string core = Path.Combine(baseDir, "NiceToolsCore.exe");
        string appDir = Path.Combine(baseDir, "resources", "app");

        if (!File.Exists(core) || !Directory.Exists(appDir))
        {
            MessageBox.Show(
                "NiceTools 文件不完整。\n\n请先把压缩包完整解压到一个普通文件夹，再运行 NiceTools.exe。\n不要直接在压缩包预览里双击程序。",
                "NiceTools",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        ProcessStartInfo psi = new ProcessStartInfo(core);
        psi.WorkingDirectory = baseDir;
        psi.UseShellExecute = false;
        psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        psi.EnvironmentVariables.Remove("ELECTRON_ENABLE_LOGGING");
        if (args != null && args.Length > 0)
        {
            psi.Arguments = JoinArgs(args);
        }

        Process process;
        try
        {
            process = Process.Start(psi);
            if (process == null)
            {
                throw new InvalidOperationException("无法创建进程");
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "无法启动 NiceTools。\n\n" + ex.Message,
                "NiceTools",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        if (process.WaitForExit(8000))
        {
            if (process.ExitCode != 0)
            {
                ShowCrash(process.ExitCode);
            }
            return;
        }

        process.Refresh();
        if (process.MainWindowHandle == IntPtr.Zero)
        {
            MessageBox.Show(
                "NiceTools 进程已经启动，但没有创建窗口。\n\n" +
                "这通常和显卡驱动、安全软件或当前运行环境有关。\n" +
                "请查看日志：\n" + LogPath(),
                "NiceTools 启动异常",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }

    private static void ShowCrash(int exitCode)
    {
        MessageBox.Show(
            "NiceTools 启动失败。\n\n退出代码：" + exitCode + "\n\n" +
            "如果程序位于 D:\\DSH MOD 等受 Windows 权限保护的目录，Electron 会被系统拦截。\n" +
            "请把整个 NiceTools 文件夹复制到 C:\\NiceTools 或桌面后再运行；\n" +
            "也可以运行同目录的 NiceTools.cmd，它会自动安装到本机应用数据目录。\n\n" +
            "日志文件：\n" + LogPath(),
            "NiceTools 启动失败",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }

    private static string LogPath()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "NiceTools",
            "logs",
            "main.log");
    }

    private static string JoinArgs(string[] args)
    {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < args.Length; i++)
        {
            if (i > 0) sb.Append(' ');
            string arg = args[i];
            if (arg.Length == 0)
            {
                sb.Append("\"\"");
                continue;
            }
            if (arg.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0)
            {
                sb.Append(arg);
                continue;
            }
            sb.Append('"');
            int backslashes = 0;
            foreach (char c in arg)
            {
                if (c == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (c == '"')
                {
                    sb.Append('\\', backslashes * 2 + 1);
                    sb.Append('"');
                    backslashes = 0;
                }
                else
                {
                    if (backslashes > 0)
                    {
                        sb.Append('\\', backslashes);
                        backslashes = 0;
                    }
                    sb.Append(c);
                }
            }
            if (backslashes > 0) sb.Append('\\', backslashes * 2);
            sb.Append('"');
        }
        return sb.ToString();
    }
}
