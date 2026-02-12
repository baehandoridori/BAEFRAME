using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

[assembly: ComVisible(true)]

namespace BAEFRAME.ContextMenu;

internal static class CommandConfig
{
  public const string Clsid = "E9C6CF8B-0E51-4C3C-83B6-42FEE932E7F4";
  public static readonly Guid CanonicalName = new("534055C0-B005-42C6-BD2A-B64966B6D4E9");

  public const string VerbLabel = "BAEFRAME\uB85C \uC5F4\uAE30";
  public const string ToolTip = "BAEFRAME\uC5D0\uC11C \uC774 \uC601\uC0C1 \uC5F4\uAE30";

  public static readonly string[] SupportedExtensions = { ".mp4", ".mov", ".avi", ".mkv", ".webm" };
  private static readonly HashSet<string> SupportedExtensionSet = new(SupportedExtensions, StringComparer.OrdinalIgnoreCase);

  public static bool IsSupportedPath(string? filePath)
  {
    if (string.IsNullOrWhiteSpace(filePath))
    {
      return false;
    }

    var ext = Path.GetExtension(filePath);
    return SupportedExtensionSet.Contains(ext);
  }
}

internal static class HResults
{
  public const int S_OK = 0;
  public const int E_FAIL = unchecked((int)0x80004005);
  public const int E_INVALIDARG = unchecked((int)0x80070057);
  public const int E_NOTIMPL = unchecked((int)0x80004001);
}

[Flags]
public enum EXPCMDFLAGS : uint
{
  ECF_DEFAULT = 0x000,
  ECF_HASSUBCOMMANDS = 0x001,
  ECF_HASSPLITBUTTON = 0x002,
  ECF_HIDELABEL = 0x004,
  ECF_ISSEPARATOR = 0x008,
  ECF_HASLUASHIELD = 0x010,
  ECF_SEPARATORBEFORE = 0x020,
  ECF_SEPARATORAFTER = 0x040,
  ECF_ISDROPDOWN = 0x080,
  ECF_TOGGLEABLE = 0x100,
  ECF_AUTOMENUICONS = 0x200
}

public enum EXPCMDSTATE
{
  ECS_ENABLED = 0,
  ECS_DISABLED = 1,
  ECS_HIDDEN = 2,
  ECS_CHECKBOX = 4,
  ECS_CHECKED = 8,
  ECS_RADIOCHECK = 0x10
}

public enum SIGDN : uint
{
  SIGDN_FILESYSPATH = 0x80058000
}

[ComImport]
[Guid("A08CE4D0-FA25-44AB-B57C-C7B1C323E0B9")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IExplorerCommand
{
  [PreserveSig]
  int GetTitle(IShellItemArray? psiItemArray, out IntPtr ppszName);

  [PreserveSig]
  int GetIcon(IShellItemArray? psiItemArray, out IntPtr ppszIcon);

  [PreserveSig]
  int GetToolTip(IShellItemArray? psiItemArray, out IntPtr ppszInfotip);

  [PreserveSig]
  int GetCanonicalName(out Guid pguidCommandName);

  [PreserveSig]
  int GetState(IShellItemArray? psiItemArray, [MarshalAs(UnmanagedType.Bool)] bool fOkToBeSlow, out EXPCMDSTATE pCmdState);

  [PreserveSig]
  int Invoke(IShellItemArray? psiItemArray, IntPtr pbc);

  [PreserveSig]
  int GetFlags(out EXPCMDFLAGS pFlags);

  [PreserveSig]
  int EnumSubCommands(out IEnumExplorerCommand? ppEnum);
}

[ComImport]
[Guid("A88826F8-186F-4987-AADE-EA0CEF8FBFE8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IEnumExplorerCommand
{
  [PreserveSig]
  int Next(uint celt, out IExplorerCommand? pUICommand, out uint pceltFetched);

  [PreserveSig]
  int Skip(uint celt);

  [PreserveSig]
  int Reset();

  [PreserveSig]
  int Clone(out IEnumExplorerCommand? ppenum);
}

[ComImport]
[Guid("B63EA76D-1F85-456F-A19C-48159EFA858B")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemArray
{
  [PreserveSig]
  int BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppvOut);

  [PreserveSig]
  int GetPropertyStore(uint flags, ref Guid riid, out IntPtr ppv);

  [PreserveSig]
  int GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);

  [PreserveSig]
  int GetAttributes(uint dwAttribFlags, uint sfgaoMask, out uint psfgaoAttribs);

  [PreserveSig]
  int GetCount(out uint pdwNumItems);

  [PreserveSig]
  int GetItemAt(uint dwIndex, out IShellItem? ppsi);

  [PreserveSig]
  int EnumItems(out IntPtr ppenumShellItems);
}

[ComImport]
[Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItem
{
  [PreserveSig]
  int BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);

  [PreserveSig]
  int GetParent(out IShellItem? ppsi);

  [PreserveSig]
  int GetDisplayName(SIGDN sigdnName, out IntPtr ppszName);

  [PreserveSig]
  int GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);

  [PreserveSig]
  int Compare(IShellItem psi, uint hint, out int piOrder);
}

[ComVisible(true)]
[Guid(CommandConfig.Clsid)]
[ClassInterface(ClassInterfaceType.None)]
public sealed class BaeframeExplorerCommand : IExplorerCommand
{
  private static readonly string ShellLogPath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
    "baeframe",
    "integration-shell.log"
  );

  public int GetTitle(IShellItemArray? psiItemArray, out IntPtr ppszName)
  {
    return TryAllocString(CommandConfig.VerbLabel, out ppszName);
  }

  public int GetIcon(IShellItemArray? psiItemArray, out IntPtr ppszIcon)
  {
    if (!AppPathResolver.TryResolveAppExecutable(out var appPath))
    {
      ppszIcon = IntPtr.Zero;
      return HResults.E_FAIL;
    }

    return TryAllocString(appPath, out ppszIcon);
  }

  public int GetToolTip(IShellItemArray? psiItemArray, out IntPtr ppszInfotip)
  {
    return TryAllocString(CommandConfig.ToolTip, out ppszInfotip);
  }

  public int GetCanonicalName(out Guid pguidCommandName)
  {
    pguidCommandName = CommandConfig.CanonicalName;
    return HResults.S_OK;
  }

  public int GetState(IShellItemArray? psiItemArray, bool fOkToBeSlow, out EXPCMDSTATE pCmdState)
  {
    try
    {
      if (!TryGetSingleFileSelection(psiItemArray, out var filePath))
      {
        pCmdState = EXPCMDSTATE.ECS_HIDDEN;
        return HResults.S_OK;
      }

      pCmdState = CommandConfig.IsSupportedPath(filePath)
        ? EXPCMDSTATE.ECS_ENABLED
        : EXPCMDSTATE.ECS_HIDDEN;

      return HResults.S_OK;
    }
    catch (Exception ex)
    {
      WriteShellLog("GetState failed", ex);
      pCmdState = EXPCMDSTATE.ECS_HIDDEN;
      return Marshal.GetHRForException(ex);
    }
  }

  public int Invoke(IShellItemArray? psiItemArray, IntPtr pbc)
  {
    try
    {
      if (!TryGetSingleFileSelection(psiItemArray, out var filePath))
      {
        return HResults.E_INVALIDARG;
      }

      if (!CommandConfig.IsSupportedPath(filePath))
      {
        return HResults.E_INVALIDARG;
      }

      if (!AppPathResolver.TryResolveAppExecutable(out var appPath))
      {
        WriteShellLog("Invoke failed: app path not found");
        return HResults.E_FAIL;
      }

      var startInfo = new ProcessStartInfo
      {
        FileName = appPath,
        Arguments = QuoteArgument(filePath),
        UseShellExecute = false,
        WorkingDirectory = Path.GetDirectoryName(appPath) ?? Environment.CurrentDirectory
      };

      Process.Start(startInfo);
      return HResults.S_OK;
    }
    catch (Exception ex)
    {
      WriteShellLog("Invoke failed", ex);
      return Marshal.GetHRForException(ex);
    }
  }

  public int GetFlags(out EXPCMDFLAGS pFlags)
  {
    pFlags = EXPCMDFLAGS.ECF_DEFAULT;
    return HResults.S_OK;
  }

  public int EnumSubCommands(out IEnumExplorerCommand? ppEnum)
  {
    ppEnum = null;
    return HResults.E_NOTIMPL;
  }

  private static bool TryGetSingleFileSelection(IShellItemArray? items, out string filePath)
  {
    filePath = string.Empty;

    if (items is null)
    {
      return false;
    }

    var hrCount = items.GetCount(out var count);
    if (hrCount != HResults.S_OK || count != 1)
    {
      return false;
    }

    var hrItem = items.GetItemAt(0, out var shellItem);
    if (hrItem != HResults.S_OK || shellItem is null)
    {
      return false;
    }

    var hrPath = shellItem.GetDisplayName(SIGDN.SIGDN_FILESYSPATH, out var pathPtr);
    if (hrPath != HResults.S_OK || pathPtr == IntPtr.Zero)
    {
      return false;
    }

    try
    {
      var selectedPath = Marshal.PtrToStringUni(pathPtr);
      if (string.IsNullOrWhiteSpace(selectedPath))
      {
        return false;
      }

      if (!File.Exists(selectedPath))
      {
        return false;
      }

      if (Directory.Exists(selectedPath))
      {
        return false;
      }

      filePath = selectedPath;
      return true;
    }
    finally
    {
      Marshal.FreeCoTaskMem(pathPtr);
    }
  }

  private static int TryAllocString(string value, out IntPtr valuePtr)
  {
    try
    {
      valuePtr = Marshal.StringToCoTaskMemUni(value);
      return HResults.S_OK;
    }
    catch (Exception ex)
    {
      WriteShellLog("Failed to allocate COM string", ex);
      valuePtr = IntPtr.Zero;
      return Marshal.GetHRForException(ex);
    }
  }

  private static string QuoteArgument(string arg)
  {
    if (arg.Contains('"'))
    {
      arg = arg.Replace("\"", "\\\"");
    }

    return $"\"{arg}\"";
  }

  private static void WriteShellLog(string message, Exception? ex = null)
  {
    try
    {
      var logDir = Path.GetDirectoryName(ShellLogPath);
      if (!string.IsNullOrWhiteSpace(logDir))
      {
        Directory.CreateDirectory(logDir);
      }

      var sb = new StringBuilder();
      sb.Append('[').Append(DateTimeOffset.Now.ToString("o")).Append("] ").Append(message);
      if (ex is not null)
      {
        sb.Append(" :: ").Append(ex.Message);
      }
      sb.AppendLine();

      File.AppendAllText(ShellLogPath, sb.ToString(), Encoding.UTF8);
    }
    catch
    {
      // Ignore logging errors in shell extension path.
    }
  }
}

internal static class AppPathResolver
{
  private const string RegistryPath = @"Software\BAEFRAME\Integration";
  private const string RegistryValueAppPath = "AppPath";

  private static readonly string StatePath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
    "baeframe",
    "integration-state.json"
  );

  public static bool TryResolveAppExecutable(out string appPath)
  {
    appPath = string.Empty;

    var fromRegistry = TryGetAppPathFromRegistry();
    if (IsValidExecutable(fromRegistry))
    {
      appPath = fromRegistry!;
      return true;
    }

    var fromState = TryGetAppPathFromState();
    if (IsValidExecutable(fromState))
    {
      appPath = fromState!;
      return true;
    }

    foreach (var candidate in GetFallbackCandidates())
    {
      if (IsValidExecutable(candidate))
      {
        appPath = candidate;
        return true;
      }
    }

    return false;
  }

  private static string? TryGetAppPathFromRegistry()
  {
    try
    {
      using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, false);
      return key?.GetValue(RegistryValueAppPath) as string;
    }
    catch
    {
      return null;
    }
  }

  private static string? TryGetAppPathFromState()
  {
    try
    {
      if (!File.Exists(StatePath))
      {
        return null;
      }

      using var document = JsonDocument.Parse(File.ReadAllText(StatePath, Encoding.UTF8));
      if (document.RootElement.TryGetProperty("appPath", out var appPathValue) && appPathValue.ValueKind == JsonValueKind.String)
      {
        return appPathValue.GetString();
      }

      return null;
    }
    catch
    {
      return null;
    }
  }

  private static bool IsValidExecutable(string? filePath)
  {
    if (string.IsNullOrWhiteSpace(filePath))
    {
      return false;
    }

    if (!File.Exists(filePath))
    {
      return false;
    }

    return string.Equals(Path.GetExtension(filePath), ".exe", StringComparison.OrdinalIgnoreCase);
  }

  private static IEnumerable<string> GetFallbackCandidates()
  {
    var environmentCandidate = Environment.GetEnvironmentVariable("BAEFRAME_APP_PATH");
    if (!string.IsNullOrWhiteSpace(environmentCandidate))
    {
      yield return environmentCandidate;
    }

    var baseDir = AppContext.BaseDirectory;
    yield return Path.Combine(baseDir, "BAEFRAME.exe");
    yield return Path.Combine(baseDir, "baeframe.exe");
  }
}


