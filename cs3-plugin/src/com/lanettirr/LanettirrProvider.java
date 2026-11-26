package com.lanettirr;

import android.os.Looper;
import com.lagradost.cloudstream3.SubtitleFile;
import com.lagradost.cloudstream3.TvType;
import com.lagradost.cloudstream3.metaproviders.TmdbProvider;
import com.lagradost.cloudstream3.utils.ExtractorLink;
import com.lagradost.cloudstream3.utils.ExtractorLinkType;
import com.lagradost.cloudstream3.utils.Qualities;
import kotlin.Unit;
import kotlin.coroutines.Continuation;
import kotlin.jvm.functions.Function1;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

public class LanettirrProvider extends TmdbProvider {
    private final String baseUrl;
    private final String providerLang;
    private final String providerName;
    private final Set<TvType> types;

    public LanettirrProvider(String baseUrl, String lang, String name) {
        super();
        String cleanBase = baseUrl == null ? "http://127.0.0.1:17410/saved" : baseUrl.trim();
        while (cleanBase.endsWith("/")) {
            cleanBase = cleanBase.substring(0, cleanBase.length() - 1);
        }
        this.baseUrl = cleanBase;
        this.providerLang = (lang == null || lang.trim().isEmpty()) ? "tr" : lang.trim();
        this.providerName = (name == null || name.trim().isEmpty()) ? "Lanettirr" : name.trim();
        this.types = Collections.unmodifiableSet(new HashSet<TvType>(Arrays.asList(
            TvType.Movie,
            TvType.TvSeries,
            TvType.Anime,
            TvType.AnimeMovie,
            TvType.AsianDrama
        )));
        setName(this.providerName);
        setMainUrl(this.baseUrl);
        setLang(this.providerLang);
    }

    @Override
    public String getName() { return this.providerName; }

    @Override
    public String getApiName() { return this.providerName; }

    @Override
    public String getMainUrl() { return this.baseUrl; }

    @Override
    public String getLang() { return this.providerLang; }

    @Override
    public boolean getHasMainPage() { return true; }

    @Override
    public boolean getUseMetaLoadResponse() { return true; }

    @Override
    public boolean getHasDownloadSupport() { return true; }

    @Override
    public boolean getHasChromecastSupport() { return true; }

    @Override
    public Long getLoadLinksTimeoutMs() { return 65000L; }

    @Override
    public Set<TvType> getSupportedTypes() { return this.types; }

    @Override
    public Object loadLinks(
        String data,
        boolean isCasting,
        Function1<? super SubtitleFile, Unit> subtitleCallback,
        Function1<? super ExtractorLink, Unit> callback,
        Continuation<? super Boolean> continuation
    ) {
        if (data == null || data.trim().isEmpty()) return Boolean.FALSE;
        try {
            String imdb = "";
            String tmdb = "";
            Integer season = null;
            Integer episode = null;
            String title = "";
            String trimmed = data.trim();

            if (trimmed.startsWith("{")) {
                JSONObject obj = new JSONObject(trimmed);
                if (!obj.isNull("imdbID")) imdb = obj.optString("imdbID", "").trim();
                if (imdb.isEmpty() && !obj.isNull("imdbId")) imdb = obj.optString("imdbId", "").trim();
                if (!obj.isNull("tmdbID")) tmdb = String.valueOf(obj.opt("tmdbID")).trim();
                if (tmdb.isEmpty() && !obj.isNull("tmdbId")) tmdb = String.valueOf(obj.opt("tmdbId")).trim();
                if (tmdb.isEmpty() && !obj.isNull("id")) tmdb = String.valueOf(obj.opt("id")).trim();
                if (!obj.isNull("season")) {
                    int sv = obj.optInt("season", -1);
                    if (sv >= 0) season = Integer.valueOf(sv);
                }
                if (!obj.isNull("episode")) {
                    int ev = obj.optInt("episode", -1);
                    if (ev >= 0) episode = Integer.valueOf(ev);
                }
                if (!obj.isNull("movieName")) title = obj.optString("movieName", "").trim();
                if (title.isEmpty() && !obj.isNull("title")) title = obj.optString("title", "").trim();
            } else if (trimmed.startsWith("tt")) {
                imdb = trimmed;
            } else if (trimmed.matches("^[0-9]+$")) {
                tmdb = trimmed;
            }

            if ("null".equalsIgnoreCase(imdb)) imdb = "";
            if ("null".equalsIgnoreCase(tmdb)) tmdb = "";
            if (tmdb.isEmpty() && imdb.isEmpty()) return Boolean.FALSE;

            String type = (season != null && episode != null) ? "series" : "movie";
            StringBuilder sb = new StringBuilder();
            sb.append(this.baseUrl).append("/cs3/streams?type=").append(type);
            if (!tmdb.isEmpty()) sb.append("&tmdb=").append(enc(tmdb));
            if (!imdb.isEmpty()) sb.append("&imdb=").append(enc(imdb));
            if (season != null) sb.append("&s=").append(season.intValue());
            if (episode != null) sb.append("&e=").append(episode.intValue());
            if (!title.isEmpty()) sb.append("&title=").append(enc(title));

            String body = fetchStringSafe(sb.toString());
            if (body == null || body.trim().isEmpty()) return Boolean.FALSE;

            JSONObject resp = new JSONObject(body);
            JSONArray subs = resp.optJSONArray("subtitles");
            if (subs != null && subtitleCallback != null) {
                for (int i = 0; i < subs.length(); i++) {
                    JSONObject so = subs.optJSONObject(i);
                    if (so == null) continue;
                    String sUrl = so.optString("url", "").trim();
                    String sLang = so.optString("lang", "Subtitle").trim();
                    if (!sUrl.isEmpty()) {
                        subtitleCallback.invoke(new SubtitleFile(sLang.isEmpty() ? "Subtitle" : sLang, sUrl));
                    }
                }
            }

            JSONArray streams = resp.optJSONArray("streams");
            if (streams == null || streams.length() == 0 || callback == null) return Boolean.FALSE;

            int emitted = 0;
            for (int i = 0; i < streams.length(); i++) {
                JSONObject st = streams.optJSONObject(i);
                if (st == null) continue;
                String streamUrl = st.optString("url", "").trim();
                if (streamUrl.isEmpty()) continue;
                String src = st.optString("source", this.providerName).trim();
                if (src.isEmpty()) src = this.providerName;
                String nm = st.optString("name", src).trim();
                if (nm.isEmpty()) nm = src;
                String ref = st.optString("referer", "");
                if (ref == null) ref = "";
                int qual = st.optInt("quality", 0);
                if (qual <= 0) qual = Qualities.Unknown.getValue();
                String typeStr = st.optString("type", "VIDEO").trim().toUpperCase();
                ExtractorLinkType linkType = ExtractorLinkType.VIDEO;
                if ("M3U8".equals(typeStr) || "HLS".equals(typeStr)) {
                    linkType = ExtractorLinkType.M3U8;
                } else if ("DASH".equals(typeStr)) {
                    linkType = ExtractorLinkType.DASH;
                }
                Map<String, String> hdrs = new HashMap<String, String>();
                JSONObject hObj = st.optJSONObject("headers");
                if (hObj != null) {
                    Iterator<String> it = hObj.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        String v = hObj.optString(k, null);
                        if (k != null && v != null && !v.isEmpty()) hdrs.put(k, v);
                    }
                }
                ExtractorLink link = new ExtractorLink(src, nm, streamUrl, ref, qual, linkType, hdrs, null);
                callback.invoke(link);
                emitted++;
            }
            return Boolean.valueOf(emitted > 0);
        } catch (Throwable t) {
            return Boolean.FALSE;
        }
    }

    private static String enc(String v) {
        try {
            return URLEncoder.encode(v, "UTF-8");
        } catch (Throwable e) {
            return v;
        }
    }

    private static boolean isAndroidMainThread() {
        try {
            Looper main = Looper.getMainLooper();
            return main != null && Looper.myLooper() == main;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static String fetchStringSafe(final String urlStr) {
        if (isAndroidMainThread()) {
            final AtomicReference<String> ref = new AtomicReference<String>(null);
            Thread th = new Thread(new Runnable() {
                @Override
                public void run() {
                    ref.set(fetchString(urlStr));
                }
            }, "lanettirr-cs3-http");
            th.setDaemon(true);
            th.start();
            try { th.join(62000L); } catch (InterruptedException ignored) {}
            return ref.get();
        }
        return fetchString(urlStr);
    }

    private static String fetchString(String urlStr) {
        String current = urlStr;
        for (int hops = 0; hops < 5; hops++) {
            HttpURLConnection conn = null;
            try {
                URL u = new URL(current);
                conn = (HttpURLConnection) u.openConnection();
                conn.setRequestMethod("GET");
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("User-Agent", "Lanettirr-CS3/1.0");
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String loc = conn.getHeaderField("Location");
                    if (loc == null || loc.trim().isEmpty()) return null;
                    current = new URL(u, loc.trim()).toString();
                    continue;
                }
                if (code < 200 || code >= 300) return null;
                try (InputStream is = conn.getInputStream()) {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) >= 0) {
                        if (n > 0) bos.write(buf, 0, n);
                    }
                    return new String(bos.toByteArray(), StandardCharsets.UTF_8);
                }
            } catch (Throwable t) {
                return null;
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Throwable ignored) {}
                }
            }
        }
        return null;
    }
}
