
package android.content;
import java.util.*;
public class Context {
  private final Map<String, SharedPreferences> prefs = new HashMap<>();
  public Context getApplicationContext() { return this; }
  public String getPackageName() { return "com.lagradost.cloudstream3"; }
  public synchronized SharedPreferences getSharedPreferences(String name, int mode) { return prefs.computeIfAbsent(name, n -> new MemPrefs()); }
  public android.content.res.Resources getResources() { return null; }
  public static class MemPrefs implements SharedPreferences {
    final Map<String, Object> m = Collections.synchronizedMap(new HashMap<>());
    public Map<String, ?> getAll() { return new HashMap<>(m); }
    public String getString(String k, String d) { Object v = m.get(k); return v instanceof String ? (String) v : d; }
    public Set<String> getStringSet(String k, Set<String> d) { Object v = m.get(k); return v instanceof Set ? (Set<String>) v : d; }
    public int getInt(String k, int d) { Object v = m.get(k); return v instanceof Integer ? (Integer) v : d; }
    public long getLong(String k, long d) { Object v = m.get(k); return v instanceof Long ? (Long) v : d; }
    public float getFloat(String k, float d) { Object v = m.get(k); return v instanceof Float ? (Float) v : d; }
    public boolean getBoolean(String k, boolean d) { Object v = m.get(k); return v instanceof Boolean ? (Boolean) v : d; }
    public boolean contains(String k) { return m.containsKey(k); }
    public Editor edit() { return new Ed(); }
    public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}
    public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}
    class Ed implements Editor {
      public Editor putString(String k, String v) { m.put(k, v); return this; }
      public Editor putStringSet(String k, Set<String> v) { m.put(k, v); return this; }
      public Editor putInt(String k, int v) { m.put(k, v); return this; }
      public Editor putLong(String k, long v) { m.put(k, v); return this; }
      public Editor putFloat(String k, float v) { m.put(k, v); return this; }
      public Editor putBoolean(String k, boolean v) { m.put(k, v); return this; }
      public Editor remove(String k) { m.remove(k); return this; }
      public Editor clear() { m.clear(); return this; }
      public boolean commit() { return true; }
      public void apply() {}
    }
  }
}
