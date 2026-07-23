using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using Microsoft.Win32.SafeHandles;

internal static class ReviewFileCasHelper
{
    private const string AbsentToken = "__ABSENT__";
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint Delete = 0x00010000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareDelete = 0x00000004;
    private const uint CreateNew = 1;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint FileFlagDeleteOnClose = 0x04000000;
    private const uint MoveFileWriteThrough = 0x00000008;
    private const int ErrorFileNotFound = 2;
    private const int ErrorPathNotFound = 3;
    private const int ErrorFileExists = 80;
    private const int ErrorAlreadyExists = 183;
    private const int ErrorSharingViolation = 32;
    private const int ErrorLockViolation = 33;
    private const int ErrorInvalidParameter = 87;
    private const int ErrorNotSupported = 50;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReplaceFileW(
        string replacedFileName,
        string replacementFileName,
        string backupFileName,
        uint replaceFlags,
        IntPtr exclude,
        IntPtr reserved);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileExW(
        string existingFileName,
        string newFileName,
        uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteFileW(string fileName);

    private static SafeFileHandle OpenExistingGuard(
        string filePath,
        bool needsDelete = false)
    {
        SafeFileHandle handle = CreateFileW(
            filePath,
            GenericRead | (needsDelete ? Delete : 0),
            FileShareRead | FileShareDelete,
            IntPtr.Zero,
            OpenExisting,
            FileAttributeNormal,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int code = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(code);
        }
        return handle;
    }

    private static bool IsBusyCode(int code)
    {
        return code == ErrorSharingViolation || code == ErrorLockViolation;
    }

    private static bool IsUnsupportedCode(int code)
    {
        return code == ErrorInvalidParameter || code == ErrorNotSupported;
    }

    private static string ToExtendedAbsolutePath(string value)
    {
        if (String.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("path is required");
        }

        string normalized = value.Replace('/', '\\');
        if (normalized.StartsWith(@"\\?\"))
        {
            return normalized;
        }
        if (normalized.StartsWith(@"\\"))
        {
            return @"\\?\UNC\" + normalized.Substring(2);
        }
        if (normalized.Length >= 3 &&
            Char.IsLetter(normalized[0]) &&
            normalized[1] == ':' &&
            normalized[2] == '\\')
        {
            return @"\\?\" + normalized;
        }

        string absolute = Path.GetFullPath(normalized);
        if (absolute.StartsWith(@"\\"))
        {
            return @"\\?\UNC\" + absolute.Substring(2);
        }
        return @"\\?\" + absolute;
    }

    private static SafeFileHandle AcquireCrashSafeLock(
        string lockPath,
        int timeoutMs)
    {
        Stopwatch stopwatch = Stopwatch.StartNew();
        while (true)
        {
            SafeFileHandle handle = CreateFileW(
                lockPath,
                GenericRead | GenericWrite | Delete,
                0,
                IntPtr.Zero,
                CreateNew,
                FileAttributeNormal | FileFlagDeleteOnClose,
                IntPtr.Zero);
            if (!handle.IsInvalid)
            {
                return handle;
            }

            int code = Marshal.GetLastWin32Error();
            handle.Dispose();
            if (code != ErrorFileExists &&
                code != ErrorAlreadyExists &&
                code != ErrorSharingViolation &&
                code != ErrorLockViolation)
            {
                throw new Win32Exception(code, "lock acquisition failed");
            }
            if (stopwatch.ElapsedMilliseconds >= timeoutMs)
            {
                throw new TimeoutException("lock acquisition timed out");
            }
            Thread.Sleep(25);
        }
    }

    private static string Hash(SafeFileHandle handle)
    {
        using (SafeFileHandle borrowed =
            new SafeFileHandle(handle.DangerousGetHandle(), false))
        using (FileStream stream = new FileStream(borrowed, FileAccess.Read))
        using (SHA256 sha = SHA256.Create())
        {
            return BitConverter.ToString(sha.ComputeHash(stream))
                .Replace("-", "")
                .ToLowerInvariant();
        }
    }

    private static string HashPath(string filePath)
    {
        using (SafeFileHandle handle = OpenExistingGuard(filePath))
        {
            return Hash(handle);
        }
    }

    private static string HashText(string value)
    {
        using (SHA256 sha = SHA256.Create())
        {
            return BitConverter.ToString(
                    sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(value)))
                .Replace("-", "")
                .ToLowerInvariant();
        }
    }

    private static string SiblingPath(string target, string fileName)
    {
        int separator = target.LastIndexOf('\\');
        if (separator < 0)
        {
            throw new ArgumentException("target directory is missing");
        }
        return target.Substring(0, separator + 1) + fileName;
    }

    private static void WriteStatus(
        TextWriter writer,
        string status,
        string details)
    {
        writer.WriteLine(
            "{\"status\":\"" + status + "\"" +
            (String.IsNullOrEmpty(details) ? "" : "," + details) +
            "}");
        writer.Flush();
    }

    private static string JsonString(string value)
    {
        return "\"" + (value ?? String.Empty)
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n")
            .Replace("\t", "\\t") + "\"";
    }

    private static int CommitAbsent(
        string target,
        string replacement,
        string replacementHash)
    {
        if (!MoveFileExW(replacement, target, MoveFileWriteThrough))
        {
            int code = Marshal.GetLastWin32Error();
            if (code == ErrorFileExists || code == ErrorAlreadyExists)
            {
                WriteStatus(
                    Console.Error,
                    "conflict",
                    "\"expected\":\"" + AbsentToken +
                    "\",\"observed\":\"exists\"");
                return 3;
            }
            if (IsBusyCode(code))
            {
                WriteStatus(Console.Error, "busy", "\"win32\":" + code);
                return 4;
            }
            string status =
                IsUnsupportedCode(code)
                    ? "unsupported"
                    : "replace-error";
            WriteStatus(Console.Error, status, "\"win32\":" + code);
            return status == "unsupported" ? 5 : 1;
        }

        string committedHash = HashPath(target);
        if (!String.Equals(
                committedHash,
                replacementHash,
                StringComparison.OrdinalIgnoreCase))
        {
            WriteStatus(
                Console.Error,
                "post-verify-mismatch",
                "\"expected\":\"" + replacementHash +
                "\",\"observed\":\"" + committedHash + "\"");
            return 7;
        }

        WriteStatus(
            Console.Out,
            "committed",
            "\"hash\":\"" + committedHash + "\"");
        return 0;
    }

    private static int RestoreDisplacedTarget(
        string target,
        string displacedPath,
        string displacedHash,
        string replacementHash,
        string transactionTag)
    {
        string backupPrefix = SiblingPath(
            target,
            ".baeframe-cas.backup-" + transactionTag + "-");
        string rescuePath = backupPrefix + "candidate-" +
            Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N");
        string currentHash;
        try
        {
            currentHash = HashPath(target);
        }
        catch (Win32Exception error)
        {
            if (error.NativeErrorCode != ErrorFileNotFound &&
                error.NativeErrorCode != ErrorPathNotFound)
            {
                WriteStatus(
                    Console.Error,
                    "indeterminate",
                    "\"reason\":\"restore-read-failed\",\"win32\":" +
                    error.NativeErrorCode +
                    ",\"backup\":" + JsonString(displacedPath));
                return 7;
            }

            if (!MoveFileExW(
                    displacedPath,
                    target,
                    MoveFileWriteThrough))
            {
                int moveCode = Marshal.GetLastWin32Error();
                WriteStatus(
                    Console.Error,
                    "indeterminate",
                    "\"reason\":\"restore-move-failed\",\"win32\":" +
                    moveCode +
                    ",\"backup\":" + JsonString(displacedPath));
                return 7;
            }
            currentHash = displacedHash;
        }

        if (!String.Equals(
                currentHash,
                replacementHash,
                StringComparison.OrdinalIgnoreCase))
        {
            WriteStatus(
                Console.Error,
                "indeterminate",
                "\"reason\":\"newer-target-during-restore\"" +
                ",\"observed\":\"" + currentHash +
                "\",\"backup\":" + JsonString(displacedPath));
            return 7;
        }

        if (!ReplaceFileW(
                target,
                displacedPath,
                rescuePath,
                0,
                IntPtr.Zero,
                IntPtr.Zero))
        {
            int code = Marshal.GetLastWin32Error();
            WriteStatus(
                Console.Error,
                "indeterminate",
                "\"reason\":\"restore-replace-failed\",\"win32\":" +
                code +
                ",\"backup\":" + JsonString(displacedPath));
            return 7;
        }

        string restoredHash;
        try
        {
            restoredHash = HashPath(target);
        }
        catch (Win32Exception error)
        {
            WriteStatus(
                Console.Error,
                "indeterminate",
                "\"reason\":\"restore-verify-failed\",\"win32\":" +
                error.NativeErrorCode +
                ",\"backup\":" + JsonString(rescuePath));
            return 7;
        }
        if (!String.Equals(
                restoredHash,
                displacedHash,
                StringComparison.OrdinalIgnoreCase))
        {
            WriteStatus(
                Console.Error,
                "indeterminate",
                "\"reason\":\"restore-verify-mismatch\"" +
                ",\"expected\":\"" + displacedHash +
                "\",\"observed\":\"" + restoredHash +
                "\",\"backup\":" + JsonString(rescuePath));
            return 7;
        }

        string rescueHash;
        try
        {
            rescueHash = HashPath(rescuePath);
        }
        catch (Win32Exception error)
        {
            WriteStatus(
                Console.Error,
                "indeterminate",
                "\"reason\":\"rescue-verify-failed\",\"win32\":" +
                error.NativeErrorCode +
                ",\"backup\":" + JsonString(rescuePath));
            return 7;
        }
        if (!String.Equals(
                rescueHash,
                replacementHash,
                StringComparison.OrdinalIgnoreCase))
        {
            string raceBackupPath = backupPrefix + "restore-race-" +
                Process.GetCurrentProcess().Id + "-" +
                Guid.NewGuid().ToString("N");
            if (!ReplaceFileW(
                    target,
                    rescuePath,
                    raceBackupPath,
                    0,
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                int code = Marshal.GetLastWin32Error();
                WriteStatus(
                    Console.Error,
                    "indeterminate",
                    "\"reason\":\"newer-target-restore-failed\"" +
                    ",\"win32\":" + code +
                    ",\"backup\":" + JsonString(rescuePath));
                return 7;
            }
            WriteStatus(
                Console.Error,
                "indeterminate",
                "\"reason\":\"newer-target-preserved\"" +
                ",\"observed\":\"" + rescueHash +
                "\",\"backup\":" + JsonString(raceBackupPath));
            return 7;
        }

        DeleteFileW(rescuePath);
        WriteStatus(
            Console.Error,
            "conflict",
            "\"reason\":\"external-race-restored\"" +
            ",\"observed\":\"" + displacedHash + "\"");
        return 3;
    }

    private static int CommitExisting(
        string target,
        string replacement,
        string expectedHash,
        string replacementHash,
        int preReplaceHoldMs,
        int postReplaceHoldMs,
        string transactionTag)
    {
        string backupPath = SiblingPath(
            target,
            ".baeframe-cas.backup-" + transactionTag + "-") +
            Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N");

        using (SafeFileHandle targetGuard = OpenExistingGuard(target))
        {
            string observedHash = Hash(targetGuard);
            WriteStatus(
                Console.Out,
                "guarded",
                "\"observed\":\"" + observedHash + "\"");

            if (!String.Equals(
                    observedHash,
                    expectedHash,
                    StringComparison.OrdinalIgnoreCase))
            {
                WriteStatus(
                    Console.Error,
                    "conflict",
                    "\"expected\":\"" + expectedHash +
                    "\",\"observed\":\"" + observedHash + "\"");
                return 3;
            }

            if (preReplaceHoldMs > 0)
            {
                Thread.Sleep(preReplaceHoldMs);
            }

            if (!ReplaceFileW(
                    target,
                    replacement,
                    backupPath,
                    0,
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                int code = Marshal.GetLastWin32Error();
                if (IsBusyCode(code))
                {
                    WriteStatus(Console.Error, "busy", "\"win32\":" + code);
                    return 4;
                }
                string status =
                    IsUnsupportedCode(code)
                        ? "unsupported"
                        : "replace-error";
                WriteStatus(Console.Error, status, "\"win32\":" + code);
                return status == "unsupported" ? 5 : 1;
            }

            string displacedHash;
            try
            {
                displacedHash = HashPath(backupPath);
            }
            catch (Win32Exception error)
            {
                WriteStatus(
                    Console.Error,
                    "indeterminate",
                    "\"reason\":\"backup-verify-failed\",\"win32\":" +
                    error.NativeErrorCode +
                    ",\"backup\":" + JsonString(backupPath));
                return 7;
            }
            if (!String.Equals(
                    displacedHash,
                    expectedHash,
                    StringComparison.OrdinalIgnoreCase))
            {
                return RestoreDisplacedTarget(
                    target,
                    backupPath,
                    displacedHash,
                    replacementHash,
                    transactionTag);
            }

            if (postReplaceHoldMs > 0)
            {
                Thread.Sleep(postReplaceHoldMs);
            }
        }

        string committedHash;
        try
        {
            committedHash = HashPath(target);
        }
        catch (Win32Exception error)
        {
            WriteStatus(
                Console.Error,
                "indeterminate",
                "\"reason\":\"post-verify-read-failed\",\"win32\":" +
                error.NativeErrorCode +
                ",\"backup\":" + JsonString(backupPath));
            return 7;
        }
        if (!String.Equals(
                committedHash,
                replacementHash,
                StringComparison.OrdinalIgnoreCase))
        {
            WriteStatus(
                Console.Error,
                "conflict",
                "\"reason\":\"superseded-after-replace\"" +
                ",\"expected\":\"" + replacementHash +
                "\",\"observed\":\"" + committedHash +
                "\",\"backup\":" + JsonString(backupPath));
            return 3;
        }

        if (!DeleteFileW(backupPath))
        {
            WriteStatus(
                Console.Out,
                "committed-with-backup",
                "\"hash\":\"" + committedHash +
                "\",\"backup\":" + JsonString(backupPath));
            return 0;
        }

        WriteStatus(
            Console.Out,
            "committed",
            "\"hash\":\"" + committedHash +
            "\",\"method\":\"replace-file\"");
        return 0;
    }

    private static int Main(string[] args)
    {
        if (args.Length < 4 || args.Length > 8)
        {
            WriteStatus(Console.Error, "usage", "");
            return 64;
        }

        try
        {
            string target = ToExtendedAbsolutePath(args[0]);
            string replacement = ToExtendedAbsolutePath(args[1]);
            string expectedHash = args[2];
            string replacementHash = args[3];
            int timeoutMs = args.Length >= 5 ? Int32.Parse(args[4]) : 5000;
            int preReplaceHoldMs =
                args.Length >= 6 ? Int32.Parse(args[5]) : 0;
            int postReplaceHoldMs =
                args.Length >= 7 ? Int32.Parse(args[6]) : 0;
            string transactionTag =
                args.Length >= 8 &&
                System.Text.RegularExpressions.Regex.IsMatch(
                    args[7],
                    "^[0-9a-fA-F-]{16,64}$")
                    ? args[7]
                    : Guid.NewGuid().ToString("N");
            string lockPath = SiblingPath(
                target,
                ".baeframe-cas.lock-" +
                HashText(target).Substring(0, 24));

            using (SafeFileHandle processLock =
                AcquireCrashSafeLock(lockPath, timeoutMs))
            {
                string observedReplacementHash = HashPath(replacement);
                if (!String.Equals(
                        observedReplacementHash,
                        replacementHash,
                        StringComparison.OrdinalIgnoreCase))
                {
                    WriteStatus(
                        Console.Error,
                        "replacement-mismatch",
                        "\"expected\":\"" + replacementHash +
                        "\",\"observed\":\"" + observedReplacementHash + "\"");
                    return 6;
                }

                if (String.Equals(
                        expectedHash,
                        AbsentToken,
                        StringComparison.Ordinal))
                {
                    return CommitAbsent(target, replacement, replacementHash);
                }

                return CommitExisting(
                    target,
                    replacement,
                    expectedHash,
                    replacementHash,
                    preReplaceHoldMs,
                    postReplaceHoldMs,
                    transactionTag);
            }
        }
        catch (TimeoutException)
        {
            WriteStatus(Console.Error, "busy", "");
            return 4;
        }
        catch (Win32Exception error)
        {
            if (error.NativeErrorCode == ErrorFileNotFound ||
                error.NativeErrorCode == ErrorPathNotFound)
            {
                WriteStatus(
                    Console.Error,
                    "conflict",
                    "\"observed\":\"missing\"");
                return 3;
            }
            if (IsBusyCode(error.NativeErrorCode))
            {
                WriteStatus(
                    Console.Error,
                    "busy",
                    "\"win32\":" + error.NativeErrorCode);
                return 4;
            }
            string status =
                IsUnsupportedCode(error.NativeErrorCode)
                    ? "unsupported"
                    : "win32-error";
            WriteStatus(
                Console.Error,
                status,
                "\"win32\":" + error.NativeErrorCode);
            return status == "unsupported" ? 5 : 1;
        }
        catch (Exception error)
        {
            WriteStatus(
                Console.Error,
                "error",
                "\"type\":\"" + error.GetType().Name + "\"");
            return 1;
        }
    }
}
