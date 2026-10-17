package local.mixtunes.mobile;

import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.FutureTask;

public final class RequestControlTest {
    static final class Connection extends HttpURLConnection {
        int disconnects;
        Connection() throws Exception { super(new URL("https://music.163.com/")); }
        @Override public void disconnect() { disconnects++; }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() {}
    }
    static void require(boolean result, String message) { if (!result) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        RequestControl active = new RequestControl(); Connection connection = new Connection();
        FutureTask<Void> work = new FutureTask<>(() -> null), deadline = new FutureTask<>(() -> null);
        active.task(work); active.deadline(deadline); active.attach(connection); active.cancel(); active.cancel();
        require(connection.disconnects == 1, "active connection must disconnect exactly once");
        require(work.isCancelled() && deadline.isCancelled(), "task and deadline must both cancel");
        try { active.check(); throw new AssertionError("canceled request continued"); } catch (InterruptedIOException expected) {}
        require(active.claimReply() && !active.claimReply(), "timeout and worker must not send duplicate replies");

        RequestControl queued = new RequestControl(); queued.cancel();
        FutureTask<Void> lateTask = new FutureTask<>(() -> { throw new AssertionError("queued canceled fetch ran"); });
        queued.task(lateTask); lateTask.run(); require(lateTask.isCancelled(), "cancel before task attachment must prevent execution");
        Connection lateConnection = new Connection();
        try { queued.attach(lateConnection); throw new AssertionError("canceled request attached connection"); } catch (InterruptedIOException expected) {}
        require(lateConnection.disconnects == 1, "late connection must be immediately disconnected");

        RequestControl completed = new RequestControl(); completed.finish();
        FutureTask<Void> lateDeadline = new FutureTask<>(() -> { throw new AssertionError("completed request timed out"); });
        completed.deadline(lateDeadline); require(lateDeadline.isCancelled(), "completion before deadline attachment must cancel deadline");
        System.out.println("RequestControl: active cancel, queued cancel, late attach, completion race, one reply PASS");
    }
}
