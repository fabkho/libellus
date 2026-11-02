package PACKAGE_ID;

import android.content.Intent;
import android.content.ComponentName;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.window.SplashScreenView;

import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsServiceConnection;

import com.google.androidbrowserhelper.trusted.TwaProviderPicker;

import java.time.Duration;
import java.time.Instant;

/**
 * Launches the app's Trusted Web Activity (docs/ANDROID.md). Written by android/scripts/patch-project.mjs
 * over Bubblewrap's, which only passes the launch URL through.
 *
 * Android 12+ draws the splash (res/drawable/splash_icon.xml, a 1000 ms animation of the mark) when this
 * activity starts, and takes it down as soon as this activity has drawn its first frame, about 250 ms
 * later; Chrome's window then covers the rest. So that the animation is seen to its end, a start from
 * the launcher icon waits for it: the splash is kept up until the animation has played (the exit
 * listener below), warming Chrome up meanwhile, and only then is the Trusted Web Activity started.
 * A start with a link, a shortcut or a share (the intent carries data or extras) does not wait.
 */
public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    /** The longest the splash may hold the launch, whatever the system reports. */
    private static final long MAX_HOLD_MS = 1100;

    private final Handler mHandler = new Handler(Looper.getMainLooper());
    private boolean mHeld;
    private boolean mLaunched;

    @Override
    protected boolean shouldLaunchImmediately() {
        mHeld = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && isPlainLauncherStart(getIntent());
        return !mHeld;
    }

    private static boolean isPlainLauncherStart(Intent intent) {
        return Intent.ACTION_MAIN.equals(intent.getAction()) && intent.getData() == null
                && intent.getExtras() == null;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!mHeld || isFinishing()) return;

        warmUpBrowser();
        // If the system never shows a splash (or never calls back), start anyway.
        mHandler.postDelayed(this::launchOnce, MAX_HOLD_MS);
        getSplashScreen().setOnExitAnimationListener(this::holdSplashUntilAnimationEnds);
    }

    private void holdSplashUntilAnimationEnds(SplashScreenView view) {
        long remaining = 0;
        Instant start = view.getIconAnimationStart();
        Duration length = view.getIconAnimationDuration();
        if (start != null && length != null) {
            remaining = Duration.between(Instant.now(), start.plus(length)).toMillis();
        }
        mHandler.postDelayed(() -> {
            launchOnce();
            view.remove();
        }, Math.max(0, Math.min(remaining, MAX_HOLD_MS)));
    }

    private void launchOnce() {
        if (mLaunched || isFinishing() || isDestroyed()) return;
        mLaunched = true;
        launchTwa();
    }

    /** Starts Chrome's process and its Custom Tabs service while the splash plays. */
    private void warmUpBrowser() {
        String provider = TwaProviderPicker.pickProvider(getPackageManager()).provider;
        CustomTabsClient.bindCustomTabsService(getApplicationContext(), provider,
                new CustomTabsServiceConnection() {
                    @Override
                    public void onCustomTabsServiceConnected(ComponentName name, CustomTabsClient client) {
                        client.warmup(0);
                    }

                    @Override
                    public void onServiceDisconnected(ComponentName name) {}
                });
    }

    @Override
    protected void onDestroy() {
        mHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
