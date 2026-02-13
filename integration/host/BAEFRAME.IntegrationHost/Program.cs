namespace BAEFRAME.IntegrationHost;

internal static class Program
{
  // This is a tiny host executable that exists only to give the MSIX package a valid
  // Application entry. The actual integration logic lives in the COM server and the
  // external BAEFRAME app.
  [STAThread]
  private static void Main()
  {
    // Intentionally no UI.
  }
}

