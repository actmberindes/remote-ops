const { execFileSync } = require('node:child_process');

const WTS_SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RemoteOpsWts {
  [StructLayout(LayoutKind.Sequential)] public struct INFO { public uint Id; public IntPtr Name; public int State; }
  [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode)] static extern bool WTSEnumerateSessionsW(IntPtr s, uint r, uint v, out IntPtr p, out uint c);
  [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode)] static extern bool WTSQuerySessionInformationW(IntPtr s, uint id, int cls, out IntPtr p, out uint n);
  [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr p);
  [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
  const int User=5, Domain=7, Active=0;
  static string Q(uint id, int cls) {
    IntPtr p=IntPtr.Zero; uint n=0;
    try { if(!WTSQuerySessionInformationW(IntPtr.Zero,id,cls,out p,out n)||p==IntPtr.Zero)return ""; return Marshal.PtrToStringUni(p)??""; }
    finally { if(p!=IntPtr.Zero) WTSFreeMemory(p); }
  }
  public static string Get() {
    IntPtr p=IntPtr.Zero; uint count=0;
    try {
      if(!WTSEnumerateSessionsW(IntPtr.Zero,0,1,out p,out count)||p==IntPtr.Zero)return "";
      int size=Marshal.SizeOf(typeof(INFO)); uint console=WTSGetActiveConsoleSessionId(); string fallback="";
      for(uint i=0;i<count;i++) {
        var row=(INFO)Marshal.PtrToStructure(IntPtr.Add(p,checked((int)(i*(uint)size))),typeof(INFO));
        if(row.State!=Active)continue;
        string user=Q(row.Id,User); if(String.IsNullOrWhiteSpace(user))continue;
        string domain=Q(row.Id,Domain); string name=String.IsNullOrWhiteSpace(domain)?user:domain+"\\"+user;
        string result=name+"|"+row.Id.ToString(); if(row.Id==console)return result; if(fallback=="")fallback=result;
      }
      return fallback;
    } finally { if(p!=IntPtr.Zero)WTSFreeMemory(p); }
  }
}
"@
[RemoteOpsWts]::Get()
`;

function getActiveWindowsSession() {
  if (process.platform !== 'win32') return { domainUser: '', sessionId: null };
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WTS_SCRIPT], {
      encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const i = output.lastIndexOf('|');
    if (i <= 0) return { domainUser: '', sessionId: null };
    const domainUser = output.slice(0, i).trim();
    const sessionId = Number(output.slice(i + 1).trim());
    if (!domainUser || !Number.isFinite(sessionId)) return { domainUser: '', sessionId: null };
    return { domainUser, sessionId };
  } catch (_) {
    return { domainUser: '', sessionId: null };
  }
}

module.exports = { getActiveWindowsSession };
