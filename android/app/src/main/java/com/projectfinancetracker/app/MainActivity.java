package com.projectfinancetracker.app;

import android.os.Bundle;
import android.view.View;
import android.view.animation.Animation;
import android.view.animation.AnimationUtils;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Find the custom splash overlay and logo
        View splashOverlay = findViewById(R.id.splash_overlay);
        ImageView splashLogo = findViewById(R.id.splash_logo);
        
        if (splashLogo != null) {
            // Load and start the pulse animation
            Animation pulse = AnimationUtils.loadAnimation(this, R.anim.pulse);
            splashLogo.startAnimation(pulse);
        }

        // Handle hiding the splash overlay when the WebView is loaded
        // Capacitor handles its own splash, but this is for our custom pulse overlay
        WebView webView = findViewById(R.id.webview);
        if (webView != null && splashOverlay != null) {
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    splashOverlay.setVisibility(View.GONE);
                }
            });
        }
    }
}
