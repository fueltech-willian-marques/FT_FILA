# rawprint.ps1 — envia bytes RAW para impressora Windows via WritePrinter API
# Uso: powershell -File rawprint.ps1 <PortaOuNome> <ArquivoBin>
param(
  [Parameter(Mandatory)][string]$PortaOuNome,
  [Parameter(Mandatory)][string]$Arquivo
)

# Localiza o nome da impressora pelo porto (USB001, LPT1, etc.) ou usa direto se for nome
if ($PortaOuNome -match '^(USB|LPT)\d+$') {
  $impressora = Get-Printer -ErrorAction SilentlyContinue |
                Where-Object { $_.PortName -eq $PortaOuNome } |
                Select-Object -First 1
  if (-not $impressora) {
    $impressora = Get-WmiObject Win32_Printer -ErrorAction SilentlyContinue |
                  Where-Object { $_.PortName -eq $PortaOuNome } |
                  Select-Object -First 1
  }
  if (-not $impressora) {
    Write-Error "Nenhuma impressora encontrada na porta $PortaOuNome"
    exit 1
  }
  $nomeImpressora = $impressora.Name
} else {
  $nomeImpressora = $PortaOuNome
}

$dados = [System.IO.File]::ReadAllBytes($Arquivo)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
    [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA di);
    [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public struct DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
}
'@ -ErrorAction Stop

$hPrinter = [IntPtr]::Zero
if (-not [RawPrinter]::OpenPrinter($nomeImpressora, [ref]$hPrinter, [IntPtr]::Zero)) {
  Write-Error "OpenPrinter falhou para '$nomeImpressora' (erro Win32: $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
  exit 1
}

try {
  $docInfo         = New-Object RawPrinter+DOCINFOA
  $docInfo.pDocName  = "ESCPOS"
  $docInfo.pDataType = "RAW"

  if (-not [RawPrinter]::StartDocPrinter($hPrinter, 1, [ref]$docInfo)) {
    Write-Error "StartDocPrinter falhou"
    exit 1
  }

  [RawPrinter]::StartPagePrinter($hPrinter) | Out-Null

  $pBytes  = [Runtime.InteropServices.Marshal]::AllocHGlobal($dados.Length)
  [Runtime.InteropServices.Marshal]::Copy($dados, 0, $pBytes, $dados.Length)
  $written = 0
  $ok      = [RawPrinter]::WritePrinter($hPrinter, $pBytes, $dados.Length, [ref]$written)
  [Runtime.InteropServices.Marshal]::FreeHGlobal($pBytes)

  [RawPrinter]::EndPagePrinter($hPrinter) | Out-Null
  [RawPrinter]::EndDocPrinter($hPrinter) | Out-Null

  if ($ok) {
    Write-Output "OK: $written bytes enviados para '$nomeImpressora'"
  } else {
    Write-Error "WritePrinter falhou (erro Win32: $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    exit 1
  }
} finally {
  [RawPrinter]::ClosePrinter($hPrinter) | Out-Null
}
