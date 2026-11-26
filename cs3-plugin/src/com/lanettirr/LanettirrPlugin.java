package com.lanettirr;

import android.content.Context;
import com.lagradost.cloudstream3.plugins.CloudstreamPlugin;
import com.lagradost.cloudstream3.plugins.Plugin;

import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

@CloudstreamPlugin
public class LanettirrPlugin extends Plugin {
    private boolean registered = false;

    @Override
    public void load(Context context) {
        registerOnce();
    }

    @Override
    public void load() {
        registerOnce();
    }

    private synchronized void registerOnce() {
        if (registered) return;
        registered = true;
        Properties props = loadEmbeddedConfig();
        String baseUrl = trimOrDefault(props.getProperty("baseUrl"), "http://127.0.0.1:17410/saved");
        String lang = trimOrDefault(props.getProperty("lang"), "tr");
        String name = trimOrDefault(props.getProperty("name"), "Lanettirr");
        registerMainAPI(new LanettirrProvider(baseUrl, lang, name));
    }

    private Properties loadEmbeddedConfig() {
        Properties props = new Properties();
        try {
            ClassLoader cl = LanettirrPlugin.class.getClassLoader();
            if (cl != null) {
                try (InputStream is = cl.getResourceAsStream("lanettirr.properties")) {
                    if (is != null) {
                        props.load(new InputStreamReader(is, StandardCharsets.UTF_8));
                        if (props.getProperty("baseUrl") != null && !props.getProperty("baseUrl").trim().isEmpty()) {
                            return props;
                        }
                    }
                }
            }
        } catch (Throwable ignored) {}

        try {
            String fn = get__filename();
            if (fn == null || fn.trim().isEmpty()) fn = getFilename();
            if (fn != null && !fn.trim().isEmpty()) {
                File f = new File(fn);
                if (f.isFile()) {
                    try (ZipFile zf = new ZipFile(f)) {
                        ZipEntry ze = zf.getEntry("lanettirr.properties");
                        if (ze != null) {
                            try (InputStream is = zf.getInputStream(ze)) {
                                props.load(new InputStreamReader(is, StandardCharsets.UTF_8));
                            }
                        }
                    }
                }
            }
        } catch (Throwable ignored) {}
        return props;
    }

    private static String trimOrDefault(String val, String fallback) {
        if (val == null) return fallback;
        String t = val.trim();
        return t.isEmpty() ? fallback : t;
    }
}
