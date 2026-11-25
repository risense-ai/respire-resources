using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Diagnostics;

public static class Card018OwnedJob {
    const uint Suspended = 4, NoWindow = 0x08000000, UseStdHandles = 0x100;
    const uint WaitOk = 0, WaitTimeout = 258, KillOnClose = 0x2000;
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long PerProcess, PerJob;
        public uint Flags;
        public UIntPtr Min, Max;
        public uint ProcessLimit;
        public UIntPtr Affinity;
        public uint Priority, Schedule;
    }
    [StructLayout(LayoutKind.Sequential)] struct IOCounts { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic;
        public IOCounts IO;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Account {
        public long A, B, C, D;
        public uint PageFaults, Total, Active, Terminated;
    }
    [StructLayout(LayoutKind.Sequential)] struct Security {
        public int Length;
        public IntPtr Descriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool Inherit;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public int Length;
        public string Reserved, Desktop, Title;
        public uint X,Y,XSize,YSize,XCount,YCount,Fill,Flags;
        public ushort Show,ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attr, IntPtr name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref ExtendedLimits limits, int size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, ref Account account, int size, IntPtr ret);
    [DllImport("kernel32.dll", EntryPoint="QueryInformationJobObject", SetLastError=true)] static extern bool QueryList(IntPtr job, int cls, IntPtr data, int size, IntPtr ret);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr proc, IntPtr job, out bool inside);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint status);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr proc, uint status);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern bool CreateProcessW(string image, StringBuilder cmdline, IntPtr process, IntPtr thread, bool inherit, uint flags, IntPtr env, string cwd, ref Startup start, out ProcessInfo info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref Security security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder image, ref int n);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(IntPtr file, StringBuilder path, uint n, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern uint K32GetProcessImageFileNameW(IntPtr proc, StringBuilder path, uint n);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);

    static void Require(bool ok, string where) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), where); }
    static uint Active(IntPtr job) {
        Account a = new Account();
        Require(QueryInformationJobObject(job, 1, ref a, Marshal.SizeOf(typeof(Account)), IntPtr.Zero), "Owned job accounting");
        return a.Active;
    }
    static HashSet<string> NativeExpected(string[] expected) {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string file in expected) {
            var security = new Security{Length=Marshal.SizeOf(typeof(Security)),Inherit=false};
            IntPtr h = CreateFileW(file, 0x80, 7, ref security, 3, 0x80, IntPtr.Zero);
            Require(h.ToInt64()!=-1, "Open pinned image file");
            try {
                var path = new StringBuilder(32768);
                uint size = GetFinalPathNameByHandleW(h, path, (uint)path.Capacity, 2);
                Require(size!=0, "Resolve pinned image NT volume path");
                if (size>=(uint)path.Capacity || !path.ToString().StartsWith(@"\Device\", StringComparison.OrdinalIgnoreCase)) {
                    throw new InvalidOperationException("Invalid pinned native image path");
                }
                result.Add(path.ToString());
            } finally { CloseHandle(h); }
        }
        return result;
    }
    static void Inspect(IntPtr job, HashSet<string> allowed, HashSet<string> nativeAllowed, IntPtr data, int size) {
        Require(QueryList(job, 3, data, size, IntPtr.Zero), "Owned process image inventory");
        int count = Marshal.ReadInt32(data, 4);
        if (count < 0 || count > 64) throw new InvalidOperationException("Unexpected owned process count");
        for (int k=0; k<count; k++) {
            uint pid = (uint)Marshal.ReadIntPtr(data, 8 + k*IntPtr.Size).ToInt64();
            const uint QueryAndSynchronize = 0x1000 | 0x00100000;
            IntPtr proc = OpenProcess(QueryAndSynchronize, false, pid);
            if (proc == IntPtr.Zero) {
                // ERROR_INVALID_PARAMETER is the Windows stale/departed PID result.
                int openError = Marshal.GetLastWin32Error();
                if (openError == 87) continue;
                throw new Win32Exception(openError, "Open owned process image (Win32 " + openError + ")");
            }
            try {
                bool inside;
                if (!IsProcessInJob(proc, job, out inside) || !inside) {
                    int jobError = Marshal.GetLastWin32Error();
                    if (WaitForSingleObject(proc, 0) == WaitOk) continue;
                    throw new Win32Exception(jobError, "Live PID did not resolve to the owned job (Win32 " + jobError + ")");
                }
                int n = 32768;
                var image = new StringBuilder(n);
                if (!QueryFullProcessImageNameW(proc, 0, image, ref n)) {
                    int imageError = Marshal.GetLastWin32Error();
                    // Do not waive any live or inaccessible image. Only this exact
                    // already-opened process handle demonstrably terminating is safe to retire.
                    if (WaitForSingleObject(proc, 0) == WaitOk) continue;
                    if (imageError != 5) throw new Win32Exception(imageError, "Query live owned process image (Win32 " + imageError + ")");
                    // Only another documented exact full path query on the same,
                    // still-owned handle can identify a live inaccessible image.
                    int nn = 32768;
                    var device = new StringBuilder(nn);
                    bool nativeOk = QueryFullProcessImageNameW(proc, 1, device, ref nn);
                    int nativeError = nativeOk ? 0 : Marshal.GetLastWin32Error();
                    if (!nativeOk) {
                        device.Clear();
                        uint nDevice = K32GetProcessImageFileNameW(proc, device, (uint)device.Capacity);
                        int deviceError = nDevice==0 ? Marshal.GetLastWin32Error() : 0;
                        if (nDevice==0) {
                            if (WaitForSingleObject(proc, 0) == WaitOk) continue;
                            throw new Win32Exception(deviceError, "Live image full path unverifiable (Win32 DOS/native/PSAPI "+
                                imageError+"/"+nativeError+"/"+deviceError+")");
                        }
                        if (nDevice>=(uint)device.Capacity) throw new InvalidOperationException("Truncated native image path");
                    } else if (nn<1 || nn>=device.Capacity) throw new InvalidOperationException("Truncated native image path");
                    if (!nativeAllowed.Contains(device.ToString())) throw new InvalidOperationException("Unexpected native executable in test job");
                    continue;
                }
                if (!allowed.Contains(image.ToString())) throw new InvalidOperationException("Unexpected child executable in test job");
            } finally { CloseHandle(proc); }
        }
    }
    static string Quote(string value) {
        if (String.IsNullOrEmpty(value) || value.Contains('"') || value.EndsWith("\\")) throw new ArgumentException("Unexpected launch argument");
        return "\"" + value + "\"";
    }
    public static int Run(string image, string[] args, string cwd, string log, string[] allowedImages, int deadlineMs) {
        var allowed = new HashSet<string>(allowedImages, StringComparer.OrdinalIgnoreCase);
        if (!allowed.Contains(image)) throw new ArgumentException("Launcher image is not fenced");
        var nativeAllowed = NativeExpected(allowedImages);
        IntPtr job=CreateJobObjectW(IntPtr.Zero, IntPtr.Zero), output=IntPtr.Zero, input=IntPtr.Zero, list=IntPtr.Zero;
        ProcessInfo p=new ProcessInfo(); bool assigned=false;
        Require(job!=IntPtr.Zero, "Create owned job");
        try {
            var limits=new ExtendedLimits(); limits.Basic.Flags=KillOnClose;
            Require(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(ExtendedLimits))), "Set owned job limits");
            var sa=new Security{Length=Marshal.SizeOf(typeof(Security)),Inherit=true};
            output=CreateFileW(log, 0x40000000, 1, ref sa, 1, 0x80, IntPtr.Zero);
            Require(output.ToInt64()!=-1, "Create isolated log");
            input=CreateFileW("NUL", 0x80000000, 3, ref sa, 3, 0x80, IntPtr.Zero);
            Require(input.ToInt64()!=-1, "Open isolated null input");
            var start=new Startup{Length=Marshal.SizeOf(typeof(Startup)),Flags=UseStdHandles,Input=input,Output=output,Error=output};
            var cmd=new StringBuilder(Quote(image)); foreach(string a in args) cmd.Append(" ").Append(Quote(a));
            Require(CreateProcessW(image,cmd,IntPtr.Zero,IntPtr.Zero,true,Suspended|NoWindow,IntPtr.Zero,cwd,ref start,out p),"Create owned launcher suspended");
            Require(AssignProcessToJobObject(job,p.Process),"Assign owned suspended process"); assigned=true;
            bool inside; Require(IsProcessInJob(p.Process,job,out inside)&&inside,"Verify owned job before resume");
            int bytes=8+64*IntPtr.Size; list=Marshal.AllocHGlobal(bytes);
            Require(ResumeThread(p.Thread)!=UInt32.MaxValue,"Resume owned launcher");
            var timer=Stopwatch.StartNew();
            while(true) {
                uint w=WaitForSingleObject(p.Process, 50);
                if(w==WaitOk) break;
                Require(w==WaitTimeout,"Wait for owned launcher");
                if(timer.ElapsedMilliseconds>=deadlineMs) throw new TimeoutException("Owned UI case reached hard deadline");
                Inspect(job,allowed,nativeAllowed,list,bytes);
            }
            var drain=Stopwatch.StartNew();
            while(Active(job)!=0 && drain.ElapsedMilliseconds<2500) { Inspect(job,allowed,nativeAllowed,list,bytes); Thread.Sleep(50); }
            if(Active(job)!=0) throw new InvalidOperationException("Launcher exited before disposing all children");
            uint code; Require(GetExitCodeProcess(p.Process,out code),"Owned launcher exit");
            return unchecked((int)code);
        } finally {
            bool clean=true;
            try {
                if(assigned && Active(job)!=0) {
                    Require(TerminateJobObject(job,98),"Terminate only the owned job");
                    var t=Stopwatch.StartNew();
                    while(Active(job)!=0 && t.ElapsedMilliseconds<5000) Thread.Sleep(50);
                    clean=Active(job)==0;
                } else if (!assigned && p.Process!=IntPtr.Zero) {
                    TerminateProcess(p.Process,98);
                    clean=WaitForSingleObject(p.Process,5000)==WaitOk;
                }
            } finally {
                CloseHandle(job);
                if(list!=IntPtr.Zero) Marshal.FreeHGlobal(list);
                if(output!=IntPtr.Zero && output.ToInt64()!=-1) CloseHandle(output);
                if(input!=IntPtr.Zero && input.ToInt64()!=-1) CloseHandle(input);
                if(p.Thread!=IntPtr.Zero) CloseHandle(p.Thread);
                if(p.Process!=IntPtr.Zero) CloseHandle(p.Process);
            }
            if(!clean) throw new InvalidOperationException("Could not verify empty owned process tree");
        }
    }
}
