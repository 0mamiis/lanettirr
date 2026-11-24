
package android.util;
public class Log {
  public static int v(String t, String m) { return 0; } public static int d(String t, String m) { return 0; } public static int i(String t, String m) { return 0; }
  public static int w(String t, String m) { return 0; } public static int e(String t, String m) { return 0; }
  public static int e(String t, String m, Throwable tr) { return 0; } public static int w(String t, Throwable tr) { return 0; } public static int d(String t, String m, Throwable tr) { return 0; }
  public static int w(String t, String m, Throwable tr) { return 0; }
  public static boolean isLoggable(String t, int l) { return false; }
  public static String getStackTraceString(Throwable tr) { return String.valueOf(tr); }
}
