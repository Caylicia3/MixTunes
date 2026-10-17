package local.mixtunes.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// MediaPlayer reads an unpredictable-length audio stream. Unlike JSON fetch,
// this proxy streams without buffering, and validates each upstream redirect.
final class MediaProxy {
    private final ServerSocket server;
    private final ExecutorService clients = Executors.newFixedThreadPool(4);
    private final Map<String, JSONObject> sources = new ConcurrentHashMap<>();
    private volatile boolean closed;
    MediaProxy() throws Exception {
        server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        Thread accept = new Thread(() -> {
            while (!closed) try { Socket socket = server.accept(); clients.execute(() -> serve(socket)); } catch (Exception ignored) {}
        }, "MixTunes-audio-proxy"); accept.setDaemon(true); accept.start();
    }
    String add(String token, JSONObject payload) { sources.put(token, payload); return "http://127.0.0.1:" + server.getLocalPort() + "/stream/" + token; }
    void remove(String token) { sources.remove(token); }
    void close() { closed = true; sources.clear(); try { server.close(); } catch (Exception ignored) {} clients.shutdownNow(); }
    private void serve(Socket socket) {
        HttpURLConnection upstream = null;
        try (Socket client = socket) {
            client.setSoTimeout(20000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
            String first = reader.readLine(); if (first == null || first.length() > 4096) return;
            String[] request = first.split(" ");
            if (request.length < 2 || !request[0].matches("GET|HEAD") || !request[1].startsWith("/stream/")) return;
            String token = request[1].substring("/stream/".length());
            JSONObject source = sources.get(token); if (source == null) { client.getOutputStream().write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII)); return; }
            JSONObject headers = new JSONObject(source.optJSONObject("headers") == null ? "{}" : source.getJSONObject("headers").toString());
            String line; int headerBytes = 0;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                headerBytes += line.length(); if (headerBytes > 32768) return;
                int colon = line.indexOf(':'); if (colon > 0 && line.substring(0, colon).equalsIgnoreCase("Range")) headers.put("Range", line.substring(colon + 1).trim());
            }
            String origin = source.getString("url"); String platform = NativeNetwork.platform(NativeNetwork.safeUrl(origin, null).getHost());
            ArrayList<String> candidates = new ArrayList<>(); candidates.add(origin);
            JSONArray alternatives = source.optJSONArray("alternatives"); if (alternatives != null) for (int i = 0; i < Math.min(8, alternatives.length()); i++) candidates.add(alternatives.optString(i));
            for (String candidate : candidates) {
                try {
                    upstream = NativeNetwork.media(candidate, headers, platform);
                    if (upstream.getResponseCode() == 200 || upstream.getResponseCode() == 206 || upstream.getResponseCode() == 416) break;
                    upstream.disconnect(); upstream = null;
                } catch (Exception ignored) { if (upstream != null) upstream.disconnect(); upstream = null; }
            }
            if (upstream == null) throw new IllegalStateException("音频来源不可用");
            int status = upstream.getResponseCode();
            StringBuilder response = new StringBuilder("HTTP/1.1 " + status + " Source\r\nConnection: close\r\n");
            for (String name : new String[]{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"}) { String value = upstream.getHeaderField(name); if (value != null && value.indexOf('\r') < 0 && value.indexOf('\n') < 0) response.append(name).append(": ").append(value).append("\r\n"); }
            response.append("\r\n"); OutputStream output = client.getOutputStream(); output.write(response.toString().getBytes(StandardCharsets.ISO_8859_1)); output.flush();
            if (!request[0].equals("HEAD") && status != 416) try (InputStream input = upstream.getInputStream()) { byte[] buffer = new byte[32768]; int length; while (!closed && sources.containsKey(token) && (length = input.read(buffer)) != -1) output.write(buffer, 0, length); output.flush(); }
        } catch (Exception ignored) { /* A canceled seek normally closes this socket. */ }
        finally { if (upstream != null) upstream.disconnect(); }
    }
}
