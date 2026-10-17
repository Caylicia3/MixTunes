package local.mixtunes.mobile;

import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

// One API fetch owns one control, including time spent waiting in the queue.
// Keep this class Android-independent so cancellation races can run on the JVM.
final class RequestControl {
    private volatile boolean canceled;
    private boolean finished;
    private HttpURLConnection connection;
    private Future<?> task, deadline;
    private final AtomicBoolean replied = new AtomicBoolean();

    void check() throws InterruptedIOException {
        if (canceled || Thread.currentThread().isInterrupted()) throw new InterruptedIOException("请求已取消或超时");
    }
    void attach(HttpURLConnection value) throws InterruptedIOException {
        boolean reject;
        synchronized (this) { reject = canceled || finished; if (!reject) connection = value; }
        if (reject) { value.disconnect(); throw new InterruptedIOException("请求已取消或超时"); }
        check();
    }
    void task(Future<?> value) {
        boolean cancel;
        synchronized (this) { task = value; cancel = canceled; }
        if (cancel) value.cancel(true);
    }
    void deadline(Future<?> value) {
        boolean cancel;
        synchronized (this) { deadline = value; cancel = canceled || finished; }
        if (cancel) value.cancel(false);
    }
    void cancel() {
        Future<?> work, timer; HttpURLConnection active;
        synchronized (this) { canceled = true; work = task; timer = deadline; active = connection; connection = null; }
        if (work != null) work.cancel(true);
        if (timer != null) timer.cancel(false);
        if (active != null) active.disconnect();
    }
    void finish() {
        Future<?> timer;
        synchronized (this) { finished = true; timer = deadline; connection = null; }
        if (timer != null) timer.cancel(false);
    }
    boolean claimReply() { return replied.compareAndSet(false, true); }
}
