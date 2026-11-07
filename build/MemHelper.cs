using System;
using System.Runtime.InteropServices;

internal static class Program
{
    [DllImport("psapi.dll", SetLastError = true)]
    private static extern bool EmptyWorkingSet(IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private const uint ProcessQueryInformation = 0x0400;
    private const uint ProcessSetQuota = 0x0100;

    private static int Main(string[] args)
    {
        int trimmed = 0;
        foreach (string arg in args)
        {
            int pid;
            if (!int.TryParse(arg, out pid) || pid <= 0) continue;
            IntPtr handle = OpenProcess(ProcessQueryInformation | ProcessSetQuota, false, pid);
            if (handle == IntPtr.Zero) continue;
            try
            {
                if (EmptyWorkingSet(handle)) trimmed++;
            }
            catch
            {
                // Best effort only. No elevation, no system-wide purge.
            }
            finally
            {
                CloseHandle(handle);
            }
        }
        return trimmed > 0 ? 0 : 1;
    }
}
