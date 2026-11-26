
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.zip.*;
import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.*;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlinx.coroutines.BuildersKt;

/** Runs CloudStream (.cs3) provider plugins on the JVM and exposes them over a small local HTTP API. */
public class Host {
  static final String PLUGINS_URL = env("BB_PLUGINS_URL", "https://raw.githubusercontent.com/F0Rextasy/bigbullapp-cs/builds/plugins.json");
  static final Path CACHE = Paths.get(env("BB_CACHE", "cache"));
  static final long SYNC_MS = Long.parseLong(env("BB_SYNC_MIN", "30")) * 60_000L;
  static final ExecutorService POOL = boundedPool(envInt("BB_THREADS", 12), "bb-worker", true);
  static final HttpClient HTTP = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.ALWAYS).connectTimeout(Duration.ofSeconds(15)).build();
  static final ObjectMapper MAPPER = new ObjectMapper();
  static final Map<String, Entry> REG = new ConcurrentHashMap<>();   // plugin internalName -> entry
  static final Object LOAD_LOCK = new Object();
  static final Object DYN_SYNC_LOCK = new Object();
  static final Map<String, List<String>> DYN_REPOS = new ConcurrentHashMap<>();
  static volatile long lastSync = 0; static volatile String lastSyncNote = "never";
  static volatile long lastDynSync = 0; static volatile String lastDynSyncNote = "idle";
  static final Set<String> SKIP = new HashSet<>(Arrays.asList("class", "recommendations", "actors", "trailers", "syncData", "comingSoon", "posterHeaders", "backgroundPosterUrl", "logoUrl", "plot", "tags", "contentRating", "duration"));

  static class Entry {
    String name, key, version, lang, url, scope = "core", repoUrl = ""; int status; List<String> tvTypes = new ArrayList<>();
    Set<String> dynLangs = ConcurrentHashMap.newKeySet();
    List<Object> providers = new ArrayList<>(); URLClassLoader loader; String error; AtomicInteger ok = new AtomicInteger(), fail = new AtomicInteger();
  }

  static String env(String k, String d) { String v = System.getenv(k); return v == null || v.isBlank() ? d : v; }
  static int envInt(String k, int d) { try { return Integer.parseInt(env(k, String.valueOf(d)).trim()); } catch (Throwable t) { return d; } }
  static ExecutorService boundedPool(int maxThreads, String name, boolean daemon) {
    int n = Math.max(2, Math.min(32, maxThreads));
    ThreadPoolExecutor ex = new ThreadPoolExecutor(n, n, 60L, TimeUnit.SECONDS, new LinkedBlockingQueue<>(), r -> {
      Thread t = new Thread(r, name);
      t.setDaemon(daemon);
      return t;
    });
    ex.allowCoreThreadTimeOut(true);
    return ex;
  }
  static void log(String m) { System.out.println(java.time.LocalTime.now().withNano(0) + " " + m); System.out.flush(); }

  // ---- plugin sync ----
  static void warmUp() {
    for (String c : new String[]{"com.lagradost.cloudstream3.MainAPIKt", "com.lagradost.cloudstream3.utils.AppUtils", "com.lagradost.cloudstream3.utils.ExtractorApiKt", "com.lagradost.cloudstream3.utils.Qualities"}) {
      try { Class.forName(c, true, Host.class.getClassLoader()); } catch (Throwable t) { log("warmup " + c + ": " + describe(t)); }
    }
  }

  static synchronized void sync() {
    try {
      warmUp();
      Files.createDirectories(CACHE);
      JsonNode arr = collectPlugins();
      int loaded = 0, skipped = 0, failed = 0; List<String> seen = new ArrayList<>();
      for (JsonNode p : arr) {
        String name = p.path("internalName").asText(); int status = p.path("status").asInt(1);
        String hash = p.path("fileHash").asText(""); String url = p.path("url").asText("");
        if (name.isEmpty() || url.isEmpty() || status == 0) { skipped++; continue; }
        seen.add(name);
        boolean adult = false; for (JsonNode t : p.path("tvTypes")) if (t.asText().equalsIgnoreCase("NSFW")) adult = true;
        if (adult || name.matches("(?i).*(porn|xham|spank|hentai|uncut|xnxx|xvideo).*")) { skipped++; continue; }
        String key = (name + "-" + hash.replace("sha256-", "").substring(0, Math.min(10, hash.replace("sha256-", "").length()))).replaceAll("[^A-Za-z0-9._-]", "_");
        Entry old = REG.get(name);
        if (old != null && old.key.equals(key) && old.error == null) { old.status = status; old.scope = "core"; continue; }
        try { loadPlugin(p, name, key, hash, url, status, old, "core", "", null); loaded++; }
        catch (Throwable t) { failed++; Entry e = old != null ? old : new Entry(); e.name = name; e.key = key; e.error = String.valueOf(t); e.status = status; e.scope = "core"; REG.putIfAbsent(name, e); log("plugin " + name + " FAILED: " + t); }
      }
      for (String n : new ArrayList<>(REG.keySet())) {
        Entry cur = REG.get(n);
        if (cur != null && "core".equals(cur.scope) && !seen.contains(n)) { removeProviders(REG.remove(n)); log("plugin removed from repo: " + n); }
      }
      lastSync = System.currentTimeMillis(); lastSyncNote = "loaded=" + loaded + " failed=" + failed + " skipped=" + skipped + " total=" + REG.size();
      log("sync: " + lastSyncNote);
    } catch (Throwable t) { lastSyncNote = "sync error: " + t; log(lastSyncNote); }
  }

  static String normBaseLang(String raw) {
    String s = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT).replace('_', '-');
    if (s.isEmpty() || s.equals("none") || s.equals("multi") || s.equals("all")) return "";
    if (s.equals("mx") || s.equals("lat") || s.equals("la") || s.equals("latam") || s.startsWith("es-")) return "es";
    if (s.equals("br") || s.startsWith("pt-")) return "pt";
    if (s.equals("cn") || s.equals("tw") || s.equals("hk") || s.equals("yue") || s.startsWith("zh-")) return "zh";
    if (s.equals("gb") || s.equals("uk") || s.equals("us") || s.startsWith("en-")) return "en";
    if (s.equals("jp")) return "ja";
    if (s.equals("kr")) return "ko";
    if (s.equals("ua")) return "uk";
    if (s.equals("gr")) return "el";
    if (s.equals("cz")) return "cs";
    if (s.equals("dk")) return "da";
    if (s.equals("se")) return "sv";
    if (s.equals("nb") || s.equals("nn")) return "no";
    if (s.equals("ir")) return "fa";
    if (s.equals("vn")) return "vi";
    if (s.equals("ph")) return "tl";
    int dash = s.indexOf('-');
    return dash > 0 ? s.substring(0, dash) : s;
  }

  static boolean langMatchesDyn(String pluginLang, String wantLang, int repoTotal) {
    String wb = normBaseLang(wantLang);
    if (wb.isEmpty()) return false;
    String pb = normBaseLang(pluginLang);
    if (!pb.isEmpty()) return pb.equals(wb);
    return repoTotal > 0 && repoTotal <= 20;
  }

  static boolean isDynVodPlugin(JsonNode p, String name) {
    if (name == null || name.isEmpty()) return false;
    if (p.path("url").asText("").isEmpty() || p.path("status").asInt(1) == 0) return false;
    if (name.matches("(?i).*(porn|xham|spank|hentai|uncut|xnxx|xvideo|torrent|magnet|iptv|live[-_ ]?tv|pluto[-_ ]?tv|radio|manga|novel|comic|audiobook|podcast|sports?live).*")) return false;
    JsonNode tv = p.path("tvTypes");
    if (tv.isArray() && tv.size() > 0) {
      boolean hasVod = false;
      for (JsonNode t : tv) {
        String v = t.asText("");
        if (v.equalsIgnoreCase("NSFW")) return false;
        if (v.equalsIgnoreCase("Movie") || v.equalsIgnoreCase("TvSeries") || v.equalsIgnoreCase("Anime") || v.equalsIgnoreCase("AnimeMovie") || v.equalsIgnoreCase("OVA") || v.equalsIgnoreCase("Cartoon") || v.equalsIgnoreCase("AsianDrama") || v.equalsIgnoreCase("Documentary")) hasVod = true;
      }
      if (!hasVod) return false;
    }
    return true;
  }

  static List<JsonNode> fetchRepoPluginList(String repoUrl) {
    List<JsonNode> out = new ArrayList<>();
    try {
      JsonNode root = MAPPER.readTree(get(repoUrl));
      if (root.isArray()) { for (JsonNode p : root) out.add(p); }
      else {
        for (JsonNode pl : root.path("pluginLists")) {
          try {
            JsonNode arr = MAPPER.readTree(get(pl.asText().replace("%s", "")));
            if (arr.isArray()) for (JsonNode p : arr) out.add(p);
          } catch (Throwable t) { log("dyn pluginList failed " + pl + ": " + t.getMessage()); }
        }
      }
    } catch (Throwable t) { log("dyn repo failed " + repoUrl + ": " + t.getMessage()); }
    return out;
  }

  static Map<String, Object> syncDynamic(Map<String, List<String>> langRepos) {
    synchronized (DYN_SYNC_LOCK) {
      Map<String, Object> res = new LinkedHashMap<>();
      try {
        warmUp();
        Files.createDirectories(CACHE);
        DYN_REPOS.clear();
        if (langRepos != null) {
          for (Map.Entry<String, List<String>> me : langRepos.entrySet()) {
            if (me.getKey() != null && !me.getKey().isBlank() && me.getValue() != null && !me.getValue().isEmpty()) {
              DYN_REPOS.put(me.getKey().trim().toLowerCase(Locale.ROOT), new ArrayList<>(me.getValue()));
            }
          }
        }
        int maxPerLang = Math.max(5, Math.min(80, envInt("BB_DYN_MAX_PER_LANG", 30)));
        int maxTotal = Math.max(10, Math.min(240, envInt("BB_DYN_MAX_TOTAL", 120)));
        Map<String, List<JsonNode>> fetchedCache = new HashMap<>();
        Map<String, JsonNode> desiredNode = new LinkedHashMap<>();
        Map<String, String> desiredRepo = new HashMap<>();
        Map<String, Set<String>> desiredLangs = new HashMap<>();
        Map<String, Integer> byLangCount = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> me : DYN_REPOS.entrySet()) {
          String lang = me.getKey();
          int langCount = 0;
          for (String repoUrl : me.getValue()) {
            if (langCount >= maxPerLang || desiredNode.size() >= maxTotal) break;
            List<JsonNode> list = fetchedCache.computeIfAbsent(repoUrl, Host::fetchRepoPluginList);
            int repoSize = list.size();
            for (JsonNode p : list) {
              if (langCount >= maxPerLang || desiredNode.size() >= maxTotal) break;
              String name = p.path("internalName").asText("").trim();
              if (!isDynVodPlugin(p, name)) continue;
              if (!langMatchesDyn(p.path("language").asText(""), lang, repoSize)) continue;
              Entry existingCore = REG.get(name);
              if (existingCore != null && "core".equals(existingCore.scope)) continue;
              if (!desiredNode.containsKey(name)) {
                desiredNode.put(name, p);
                desiredRepo.put(name, repoUrl);
                desiredLangs.put(name, new LinkedHashSet<>());
              }
              if (desiredLangs.get(name).add(lang)) langCount++;
            }
          }
          byLangCount.put(lang, langCount);
        }
        int unloaded = 0;
        for (String n : new ArrayList<>(REG.keySet())) {
          Entry cur = REG.get(n);
          if (cur != null && "dyn".equals(cur.scope) && !desiredNode.containsKey(n)) {
            removeProviders(REG.remove(n));
            unloaded++;
          }
        }
        int loaded = 0, reused = 0, failed = 0;
        for (Map.Entry<String, JsonNode> de : desiredNode.entrySet()) {
          String name = de.getKey();
          JsonNode p = de.getValue();
          int status = p.path("status").asInt(1);
          String hash = p.path("fileHash").asText("");
          String url = p.path("url").asText("");
          String cleanHash = hash.replace("sha256-", "");
          String key = (name + "-" + cleanHash.substring(0, Math.min(10, cleanHash.length()))).replaceAll("[^A-Za-z0-9._-]", "_");
          Entry old = REG.get(name);
          Set<String> dLangs = desiredLangs.get(name);
          String rUrl = desiredRepo.getOrDefault(name, "");
          if (old != null && old.key.equals(key) && old.error == null) {
            old.status = status;
            old.repoUrl = rUrl;
            old.dynLangs.clear();
            if (dLangs != null) old.dynLangs.addAll(dLangs);
            reused++;
            continue;
          }
          try { loadPlugin(p, name, key, hash, url, status, old, "dyn", rUrl, dLangs); loaded++; }
          catch (Throwable t) {
            failed++;
            log("dyn plugin " + name + " FAILED: " + t.getMessage());
          }
        }
        int activeDyn = 0;
        for (Entry e : REG.values()) if ("dyn".equals(e.scope) && e.error == null) activeDyn++;
        lastDynSync = System.currentTimeMillis();
        lastDynSyncNote = "loaded=" + loaded + " reused=" + reused + " unloaded=" + unloaded + " failed=" + failed + " activeDyn=" + activeDyn;
        log("dyn-sync: " + lastDynSyncNote);
        res.put("ok", true); res.put("loaded", loaded); res.put("reused", reused); res.put("unloaded", unloaded); res.put("failed", failed); res.put("activeDyn", activeDyn); res.put("byLang", byLangCount);
        return res;
      } catch (Throwable t) {
        lastDynSyncNote = "error: " + t;
        log("dyn-sync error: " + t);
        res.put("ok", false); res.put("error", String.valueOf(t));
        return res;
      }
    }
  }

  /** Repo URLs come from repos.txt (one per line, # = disabled) or BB_PLUGINS_URL. repo.json (pluginLists) and plugins.json arrays are both accepted. */
  static JsonNode collectPlugins() throws Exception {
    List<String> urls = new ArrayList<>();
    Path rf = Paths.get(env("BB_REPOS_FILE", "repos.txt"));
    if (Files.exists(rf)) for (String l : Files.readAllLines(rf)) { l = l.trim(); if (!l.isEmpty() && !l.startsWith("#")) urls.add(l); }
    if (urls.isEmpty()) urls.add(PLUGINS_URL);
    com.fasterxml.jackson.databind.node.ArrayNode merged = MAPPER.createArrayNode();
    Set<String> seenNames = new HashSet<>();
    for (String u : urls) {
      try {
        JsonNode root = MAPPER.readTree(get(u));
        List<JsonNode> lists = new ArrayList<>();
        if (root.isArray()) lists.add(root);
        else for (JsonNode pl : root.path("pluginLists")) { try { lists.add(MAPPER.readTree(get(pl.asText().replace("%s", "")))); } catch (Throwable t) { log("pluginList failed " + pl + ": " + t); } }
        for (JsonNode l : lists) for (JsonNode p : l) if (seenNames.add(p.path("internalName").asText())) merged.add(p);
      } catch (Throwable t) { log("repo failed " + u + ": " + t); }
    }
    return merged;
  }

  static void loadPlugin(JsonNode p, String name, String key, String hash, String url, int status, Entry old, String scope, String repoUrl, Set<String> dynLangs) throws Exception {
    Path cs3 = CACHE.resolve(key + ".cs3"), jar = CACHE.resolve(key + ".jar");
    if (!Files.exists(jar)) {
      byte[] data = getBytes(url);
      String want = hash.replace("sha256-", "").toLowerCase();
      String got = hex(MessageDigest.getInstance("SHA-256").digest(data));
      if (!want.isEmpty() && !want.equals(got)) throw new IOException("hash mismatch (expected " + want.substring(0, 8) + " got " + got.substring(0, 8) + ")");
      Files.write(cs3, data);
      dex2jar(cs3, jar);
    }
    String pluginClass;
    try (ZipFile z = new ZipFile(cs3.toFile())) { pluginClass = MAPPER.readTree(z.getInputStream(z.getEntry("manifest.json"))).path("pluginClassName").asText(); }
    Entry e = new Entry(); e.name = name; e.key = key; e.status = status; e.version = p.path("version").asText(); e.lang = p.path("language").asText(""); e.url = url; e.scope = scope != null ? scope : "core"; e.repoUrl = repoUrl != null ? repoUrl : "";
    if (dynLangs != null) e.dynLangs.addAll(dynLangs);
    for (JsonNode t : p.path("tvTypes")) e.tvTypes.add(t.asText());
    synchronized (LOAD_LOCK) {
      URLClassLoader cl = new URLClassLoader(new URL[]{jar.toUri().toURL()}, Host.class.getClassLoader());
      try {
        Class<?> pc = Class.forName(pluginClass, true, cl);
        Object plugin = pc.getDeclaredConstructor().newInstance();
        List<Object> all = allProviders(); int before = all.size();
        boolean did = false;
        for (Method m : pc.getMethods()) if (m.getName().equals("load") && m.getParameterCount() == 1) { m.invoke(plugin, new android.content.Context()); did = true; break; }
        if (!did) pc.getMethod("load").invoke(plugin);
        all = allProviders();
        e.providers = new ArrayList<>(all.subList(before, all.size()));
        e.loader = cl;
        if (old != null) { removeProviders(old); }
        REG.put(name, e);
      } catch (Throwable t) {
        try { cl.close(); } catch (Throwable ignored) {}
        throw t;
      }
    }
    log("plugin " + name + " v" + e.version + " -> " + e.providers.size() + " provider(s)");
  }

  @SuppressWarnings("unchecked") static List<Object> allProviders() throws Exception {
    Class<?> holder = Class.forName("com.lagradost.cloudstream3.APIHolder");
    return (List<Object>) holder.getMethod("getAllProviders").invoke(holder.getField("INSTANCE").get(null));
  }
  static void removeProviders(Entry e) { if (e == null) return; try { allProviders().removeAll(e.providers); } catch (Throwable ignored) {} if (e.loader != null) { try { e.loader.close(); } catch (Throwable ignored) {} e.loader = null; } }

  static void dex2jar(Path in, Path out) throws Exception {
    boolean win = System.getProperty("os.name").toLowerCase().contains("win");
    Path tool = Paths.get(env("BB_DEX2JAR", "tools/dex-tools-v2.4")).resolve(win ? "d2j-dex2jar.bat" : "d2j-dex2jar.sh");
    ProcessBuilder pb = new ProcessBuilder(tool.toAbsolutePath().toString(), "-f", "-o", out.toAbsolutePath().toString(), in.toAbsolutePath().toString());
    pb.redirectErrorStream(true);
    Process pr = pb.start(); String outp = new String(pr.getInputStream().readAllBytes());
    if (!pr.waitFor(120, TimeUnit.SECONDS) || pr.exitValue() != 0 || !Files.exists(out)) throw new IOException("dex2jar failed: " + outp);
  }

  static String get(String url) throws Exception { return new String(getBytes(url), StandardCharsets.UTF_8); }
  static byte[] getBytes(String url) throws Exception {
    HttpResponse<byte[]> r = HTTP.send(HttpRequest.newBuilder(URI.create(url)).header("User-Agent", "bb-host").timeout(Duration.ofSeconds(60)).build(), HttpResponse.BodyHandlers.ofByteArray());
    if (r.statusCode() != 200) throw new IOException("HTTP " + r.statusCode() + " " + url);
    return r.body();
  }
  static String hex(byte[] b) { StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format("%02x", x)); return s.toString(); }

  // ---- provider calls ----
  static Object findProvider(String name) {
    for (Entry e : REG.values()) for (Object p : e.providers) { try { if (name.equalsIgnoreCase(String.valueOf(p.getClass().getMethod("getName").invoke(p)))) return p; } catch (Throwable ignored) {} }
    return null;
  }
  static Entry entryOf(Object prov) { for (Entry e : REG.values()) if (e.providers.contains(prov)) return e; return null; }

  @SuppressWarnings({"rawtypes", "unchecked"})
  static Object blocking(java.util.function.Function<Object, Object> f) throws Exception {
    return BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (kotlin.jvm.functions.Function2) (scope, cont) -> f.apply(cont));
  }
  static Object invoke(Method m, Object target, Object... args) { try { return m.invoke(target, args); } catch (InvocationTargetException e) { throw new RuntimeException(e.getCause()); } catch (Exception e) { throw new RuntimeException(e); } }

  static Object search(Object prov, String q) throws Exception {
    Method two = null, three = null;
    for (Method m : prov.getClass().getMethods()) if (m.getName().equals("search")) {
      boolean own = m.getDeclaringClass() != Class.forName("com.lagradost.cloudstream3.MainAPI");
      if (m.getParameterCount() == 2 && (two == null || own)) two = m; else if (m.getParameterCount() == 3 && (three == null || own)) three = m;
    }
    boolean twoOwn = two != null && two.getDeclaringClass() != Class.forName("com.lagradost.cloudstream3.MainAPI");
    final Method a = twoOwn || three == null ? two : null, b = three;
    return blocking(c -> a != null ? invoke(a, prov, q, c) : invoke(b, prov, q, 1, c));
  }
  static Object load(Object prov, String url) throws Exception {
    Method m = null; for (Method x : prov.getClass().getMethods()) if (x.getName().equals("load") && x.getParameterCount() == 2 && x.getParameterTypes()[0] == String.class) m = x;
    final Method mm = m; return blocking(c -> invoke(mm, prov, url, c));
  }
  @SuppressWarnings({"rawtypes", "unchecked"})
  static Map<String, Object> links(Entry e, Object prov, String data) throws Exception {
    List<Object> links = Collections.synchronizedList(new ArrayList<>()), subs = Collections.synchronizedList(new ArrayList<>());
    Method m = null; for (Method x : prov.getClass().getMethods()) if (x.getName().equals("loadLinks") && x.getParameterCount() == 5) m = x;
    final Method mm = m;
    kotlin.jvm.functions.Function1 onSub = s -> { subs.add(s); return kotlin.Unit.INSTANCE; };
    kotlin.jvm.functions.Function1 onLink = l -> { links.add(l); return kotlin.Unit.INSTANCE; };
    Future<Object> f = POOL.submit(() -> blocking(c -> invoke(mm, prov, data, false, onSub, onLink, c)));
    try { f.get(45, TimeUnit.SECONDS); }
    catch (TimeoutException te) { f.cancel(true); }
    catch (ExecutionException ee) { if (links.isEmpty()) { if (e != null) e.fail.incrementAndGet(); Throwable c2 = ee.getCause(); throw new RuntimeException(c2 == null ? ee : c2); } }
    if (e != null) e.ok.incrementAndGet();
    Map<String, Object> out = new LinkedHashMap<>(); out.put("links", new ArrayList<>(links)); out.put("subs", new ArrayList<>(subs)); return out;
  }

  // ---- JSON ----
  static void ser(Object o, StringBuilder sb, int depth, IdentityHashMap<Object, Boolean> path) {
    if (o == null) { sb.append("null"); return; }
    if (o instanceof CharSequence || o instanceof Character) { str(o.toString(), sb); return; }
    if (o instanceof Number || o instanceof Boolean) { sb.append(o); return; }
    if (o instanceof Enum) { str(((Enum<?>) o).name(), sb); return; }
    if (path.containsKey(o) || depth > 4) { str(String.valueOf(o).length() > 120 ? String.valueOf(o).substring(0, 120) : String.valueOf(o), sb); return; }
    path.put(o, true);
    try {
      if (o instanceof Map) { sb.append('{'); boolean f = true; for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) { if (!f) sb.append(','); f = false; str(String.valueOf(e.getKey()), sb); sb.append(':'); ser(e.getValue(), sb, depth + 1, path); } sb.append('}'); }
      else if (o instanceof Iterable || o.getClass().isArray()) {
        sb.append('['); boolean f = true; int n = 0;
        Iterable<?> it = o instanceof Iterable ? (Iterable<?>) o : Arrays.asList((Object[]) o);
        for (Object x : it) { if (n++ >= 1500) break; if (!f) sb.append(','); f = false; ser(x, sb, depth + 1, path); }
        sb.append(']');
      } else {
        sb.append('{'); boolean f = true; Set<String> done = new HashSet<>();
        for (Method m : o.getClass().getMethods()) {
          String n = m.getName(); if (m.getParameterCount() != 0 || Modifier.isStatic(m.getModifiers()) || m.getDeclaringClass() == Object.class) continue;
          String prop = n.startsWith("get") && n.length() > 3 ? Character.toLowerCase(n.charAt(3)) + n.substring(4) : (n.startsWith("is") && n.length() > 2 ? Character.toLowerCase(n.charAt(2)) + n.substring(3) : null);
          if (prop == null || SKIP.contains(prop) || !done.add(prop)) continue;
          Object v; try { v = m.invoke(o); } catch (Throwable t) { continue; }
          if (!f) sb.append(','); f = false; str(prop, sb); sb.append(':'); ser(v, sb, depth + 1, path);
        }
        sb.append('}');
      }
    } finally { path.remove(o); }
  }
  static String describe(Throwable t) {
    StringBuilder sb = new StringBuilder(); int n = 0;
    for (Throwable c = t; c != null && n < 5; c = c.getCause(), n++) { StackTraceElement[] st = c.getStackTrace(); sb.append(n > 0 ? " <- " : "").append(c.getClass().getSimpleName()).append(": ").append(String.valueOf(c.getMessage()), 0, Math.min(120, String.valueOf(c.getMessage()).length())); if (st.length > 0) sb.append(" @").append(st[0].getClassName()).append(".").append(st[0].getMethodName()); }
    return sb.toString();
  }
  static void str(String s, StringBuilder sb) {
    sb.append('"');
    for (int i = 0; i < s.length(); i++) { char c = s.charAt(i);
      switch (c) { case '"': sb.append("\\\""); break; case '\\': sb.append("\\\\"); break; case '\n': sb.append("\\n"); break; case '\r': sb.append("\\r"); break; case '\t': sb.append("\\t"); break;
        default: if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c); } }
    sb.append('"');
  }
  static String json(Object o) { StringBuilder sb = new StringBuilder(); ser(o, sb, 0, new IdentityHashMap<>()); return sb.toString(); }

  // ---- HTTP ----
  static Map<String, String> query(URI u) {
    Map<String, String> m = new HashMap<>(); String q = u.getRawQuery(); if (q == null) return m;
    for (String kv : q.split("&")) { int i = kv.indexOf('='); if (i < 0) continue; m.put(URLDecoder.decode(kv.substring(0, i), StandardCharsets.UTF_8), URLDecoder.decode(kv.substring(i + 1), StandardCharsets.UTF_8)); }
    return m;
  }
  static void reply(HttpExchange ex, int code, String body) throws IOException {
    byte[] b = body.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8"); ex.sendResponseHeaders(code, b.length);
    try (OutputStream os = ex.getResponseBody()) { os.write(b); }
  }
  static Object timed(Entry e, long ms, Callable<Object> c) throws Exception {
    Future<Object> f = POOL.submit(c);
    try { Object r = f.get(ms, TimeUnit.MILLISECONDS); if (e != null) e.ok.incrementAndGet(); return r; }
    catch (TimeoutException t) { f.cancel(true); if (e != null) e.fail.incrementAndGet(); throw new RuntimeException("timeout"); }
    catch (ExecutionException x) { if (e != null) e.fail.incrementAndGet(); Throwable c2 = x.getCause(); throw new RuntimeException(c2 == null ? x : c2); }
  }

  static void handle(HttpExchange ex) throws IOException {
    try {
      URI u = ex.getRequestURI(); String path = u.getPath(); Map<String, String> q = query(u);
      if (path.equals("/health")) {
        int dynCnt = 0; for (Entry e : REG.values()) if ("dyn".equals(e.scope) && e.error == null) dynCnt++;
        reply(ex, 200, "{\"plugins\":" + REG.size() + ",\"dynPlugins\":" + dynCnt + ",\"lastSync\":" + lastSync + ",\"note\":" + json(lastSyncNote) + ",\"dynNote\":" + json(lastDynSyncNote) + "}"); return;
      }
      if (path.equals("/providers")) {
        List<Object> out = new ArrayList<>();
        for (Entry e : REG.values()) for (Object p : e.providers) {
          Map<String, Object> m = new LinkedHashMap<>(); try { m.put("name", p.getClass().getMethod("getName").invoke(p)); m.put("mainUrl", p.getClass().getMethod("getMainUrl").invoke(p)); } catch (Throwable t) { continue; }
          m.put("plugin", e.name); m.put("version", e.version); m.put("status", e.status); m.put("lang", e.lang); m.put("tvTypes", e.tvTypes); m.put("scope", e.scope); m.put("repoUrl", e.repoUrl); m.put("dynLangs", new ArrayList<>(e.dynLangs)); m.put("ok", e.ok.get()); m.put("fail", e.fail.get()); out.add(m);
        }
        reply(ex, 200, json(out)); return;
      }
      if (path.equals("/sync")) { POOL.submit(Host::sync); reply(ex, 200, "{\"started\":true}"); return; }
      if (path.equals("/dyn-sync") && "POST".equalsIgnoreCase(ex.getRequestMethod())) {
        byte[] bodyBytes = ex.getRequestBody().readNBytes(131072);
        JsonNode root = bodyBytes.length > 0 ? MAPPER.readTree(bodyBytes) : MAPPER.createObjectNode();
        Map<String, List<String>> reqLangs = new LinkedHashMap<>();
        JsonNode langsNode = root.path("langs");
        if (langsNode.isObject()) {
          Iterator<Map.Entry<String, JsonNode>> it = langsNode.fields();
          while (it.hasNext()) {
            Map.Entry<String, JsonNode> fe = it.next();
            List<String> urls = new ArrayList<>();
            if (fe.getValue().isArray()) for (JsonNode uNode : fe.getValue()) { String us = uNode.asText("").trim(); if (us.startsWith("http://") || us.startsWith("https://")) urls.add(us); }
            if (!urls.isEmpty()) reqLangs.put(fe.getKey(), urls);
          }
        }
        if ("1".equals(q.get("async"))) {
          POOL.submit(() -> syncDynamic(reqLangs));
          reply(ex, 200, "{\"ok\":true,\"started\":true}");
        } else {
          reply(ex, 200, json(syncDynamic(reqLangs)));
        }
        return;
      }
      Object prov = findProvider(q.getOrDefault("p", "")); if (prov == null) { reply(ex, 404, "{\"error\":\"unknown provider\"}"); return; }
      Entry en = entryOf(prov);
      try {
        if (path.equals("/search")) reply(ex, 200, json(timed(en, 25000, () -> search(prov, q.get("q")))));
        else if (path.equals("/load")) reply(ex, 200, json(timed(en, 30000, () -> load(prov, q.get("url")))));
        else if (path.equals("/links")) reply(ex, 200, json(links(en, prov, q.get("data"))));
        else reply(ex, 404, "{\"error\":\"not found\"}");
      } catch (RuntimeException re) { log("ERR " + path + " " + q.getOrDefault("p", "") + ": " + describe(re)); reply(ex, 200, "{\"error\":" + json(describe(re)) + "}"); }
    } catch (Throwable t) { reply(ex, 500, "{\"error\":" + json(String.valueOf(t)) + "}"); }
  }

  public static void main(String[] a) throws Exception {
    int port = Integer.parseInt(env("BB_PORT", "7200"));
    HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
    s.setExecutor(boundedPool(envInt("BB_HTTP_THREADS", 16), "bb-http", false));
    s.createContext("/", Host::handle); s.start();
    log("bigbull host on http://127.0.0.1:" + port);
    POOL.submit(Host::sync);
    ScheduledExecutorService sch = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "bb-sync"); t.setDaemon(true); return t; });
    sch.scheduleWithFixedDelay(() -> { sync(); if (!DYN_REPOS.isEmpty()) syncDynamic(new LinkedHashMap<>(DYN_REPOS)); }, SYNC_MS, SYNC_MS, TimeUnit.MILLISECONDS);
  }
}

