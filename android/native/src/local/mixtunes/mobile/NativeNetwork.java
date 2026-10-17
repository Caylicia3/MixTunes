package local.mixtunes.mobile;

import android.util.Base64;
import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

final class NativeNetwork {
    static final int MAX_BODY = 12 * 1024 * 1024;
    static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    static boolean suffix(String host, String root) { return host.equals(root) || host.endsWith("." + root); }
    static String platform(String host) {
        host = host.toLowerCase(java.util.Locale.ROOT);
        if (suffix(host, "y.qq.com") || suffix(host, "qqmusic.qq.com") || host.equals("aqqmusic.tc.qq.com") || suffix(host, "gtimg.cn") || suffix(host, "qpic.cn")) return "qq";
        if (host.equals("music.163.com") || host.equals("y.music.163.com") || host.equals("interface.music.163.com") || host.equals("interface3.music.163.com") || host.equals("163cn.tv") || suffix(host, "music.126.net")) return "netease";
        if (suffix(host, "bilibili.com") || host.equals("b23.tv") || suffix(host, "bilivideo.com") || suffix(host, "bilivideo.cn") || suffix(host, "hdslb.com")) return "bilibili";
        return "";
    }
    static URL safeUrl(String value, String expected) throws Exception {
        URI uri = new URI(value);
        String host = uri.getHost();
        if (host == null || uri.getRawUserInfo() != null || !"https".equalsIgnoreCase(uri.getScheme()) || (uri.getPort() != -1 && uri.getPort() != 443)) throw new SecurityException("仅支持官方 HTTPS 地址");
        String actual = platform(host);
        if (actual.isEmpty() || expected != null && !expected.isEmpty() && !expected.equals(actual)) throw new SecurityException("来源地址不受支持");
        return uri.toURL();
    }
    static HttpURLConnection open(String value, String method, JSONObject headers, byte[] body, String expected) throws Exception {
        return open(value, method, headers, body, expected, null);
    }
    static HttpURLConnection open(String value, String method, JSONObject headers, byte[] body, String expected, RequestControl control) throws Exception {
        if (control != null) control.check();
        URL url = safeUrl(value, expected);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
        if (control != null) control.attach(connection);
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
        connection.setRequestMethod(method); connection.setRequestProperty("User-Agent", UA);
        connection.setRequestProperty("Accept-Encoding", "identity");
        if (headers != null) {
            Iterator<String> names = headers.keys();
            while (names.hasNext()) {
                String name = names.next(), field = headers.optString(name, "");
                if (name.matches("(?i)host|connection|content-length|cookie|set-cookie|accept-encoding") || name.indexOf('\r') >= 0 || name.indexOf('\n') >= 0 || field.indexOf('\r') >= 0 || field.indexOf('\n') >= 0) continue;
                connection.setRequestProperty(name, field);
            }
        }
        String cookies = CookieManager.getInstance().getCookie(url.toString());
        if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
        if (control != null) control.check();
        if (body != null && body.length > 0) { connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length); try (OutputStream stream = connection.getOutputStream()) { for (int offset = 0; offset < body.length; offset += 8192) { if (control != null) control.check(); stream.write(body, offset, Math.min(8192, body.length - offset)); } } }
        if (control != null) control.check();
        return connection;
        } catch (Exception error) { connection.disconnect(); throw error; }
    }
    static void saveCookies(HttpURLConnection connection) {
        CookieManager cookies = CookieManager.getInstance();
        for (Map.Entry<String, List<String>> field : connection.getHeaderFields().entrySet()) if (field.getKey() != null && field.getKey().equalsIgnoreCase("Set-Cookie")) for (String value : field.getValue()) cookies.setCookie(connection.getURL().toString(), value);
        cookies.flush();
    }
    static byte[] read(InputStream stream, int limit) throws Exception {
        return read(stream, limit, null);
    }
    static byte[] read(InputStream stream, int limit, RequestControl control) throws Exception {
        if (stream == null) return new byte[0];
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int length;
            while (true) { if (control != null) control.check(); length = input.read(buffer); if (length == -1) break; if (control != null) control.check(); if (output.size() + length > limit) throw new IllegalStateException("响应内容超过 12 MB"); output.write(buffer, 0, length); }
            return output.toByteArray();
        }
    }
    static JSONObject fetch(JSONObject payload) throws Exception {
        return fetch(payload, null);
    }
    static JSONObject fetch(JSONObject payload, RequestControl control) throws Exception {
        String value = payload.getString("url"), method = payload.optString("method", "GET").toUpperCase(java.util.Locale.ROOT);
        if (!method.matches("GET|POST|HEAD|OPTIONS")) throw new SecurityException("不支持的请求方式");
        byte[] body = payload.has("bodyBase64") ? Base64.decode(payload.getString("bodyBase64"), Base64.DEFAULT) : payload.has("body") ? payload.optString("body").getBytes(StandardCharsets.UTF_8) : null;
        if (body != null && body.length > MAX_BODY) throw new IllegalStateException("请求内容过大");
        HttpURLConnection connection = open(value, method, payload.optJSONObject("headers"), body, null, control);
        try {
            if (control != null) control.check();
            int status = connection.getResponseCode(); if (control != null) control.check(); saveCookies(connection);
            if (connection.getContentLengthLong() > MAX_BODY) throw new IllegalStateException("响应内容超过 12 MB");
            JSONObject headers = new JSONObject();
            for (Map.Entry<String, List<String>> field : connection.getHeaderFields().entrySet()) if (field.getKey() != null && !field.getKey().equalsIgnoreCase("Set-Cookie")) headers.put(field.getKey().toLowerCase(java.util.Locale.ROOT), android.text.TextUtils.join(", ", field.getValue()));
            InputStream input = method.equals("HEAD") || status == 204 || status == 304 ? null : status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            return Json.object("status", status, "headers", headers, "bodyBase64", Base64.encodeToString(read(input, MAX_BODY, control), Base64.NO_WRAP), "url", connection.getURL().toString());
        } finally { connection.disconnect(); }
    }
    static HttpURLConnection media(String value, JSONObject headers, String expected) throws Exception {
        String current = value;
        for (int count = 0; count <= 5; count++) {
            HttpURLConnection connection = open(current, "GET", headers, null, expected);
            int status = connection.getResponseCode(); saveCookies(connection);
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location");
                if (location == null || count == 5) { connection.disconnect(); throw new IllegalStateException("音频来源跳转失败"); }
                String next = new URL(connection.getURL(), location).toString(); connection.disconnect(); safeUrl(next, expected); current = next;
            } else return connection;
        }
        throw new IllegalStateException("音频来源跳转失败");
    }
}
