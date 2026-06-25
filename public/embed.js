(function () {
    var script = document.currentScript;

    if (!script) {
        var scripts = document.getElementsByTagName("script");
        script = scripts[scripts.length - 1];
    }

    if (!script) return;

    var client = script.getAttribute("data-client") || "demo";
    var widgetUrl =
        script.getAttribute("data-src") ||
        "https://mortgage-lead-widget.vercel.app/";

    var minHeight = parseInt(script.getAttribute("data-min-height") || "700", 10);
    var maxHeight = parseInt(script.getAttribute("data-max-height") || "5000", 10);

    if (!Number.isFinite(minHeight) || minHeight < 300) minHeight = 700;
    if (!Number.isFinite(maxHeight) || maxHeight < minHeight) maxHeight = 5000;

    var iframeUrl = new URL(widgetUrl);
    iframeUrl.searchParams.set("client", client);
    iframeUrl.searchParams.set("embed", "1");

    var allowedOrigin = iframeUrl.origin;

    var wrapper = document.createElement("div");
    wrapper.setAttribute("data-mortgage-lead-wrapper", client);
    wrapper.style.width = "100%";
    wrapper.style.maxWidth = "100%";
    wrapper.style.overflow = "hidden";
    wrapper.style.margin = "0";
    wrapper.style.padding = "0";

    var iframe = document.createElement("iframe");
    iframe.src = iframeUrl.toString();
    iframe.title = script.getAttribute("data-title") || "Mortgage estimate form";
    iframe.loading = "lazy";
    iframe.scrolling = "no";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";

    iframe.style.width = "100%";
    iframe.style.height = minHeight + "px";
    iframe.style.minHeight = minHeight + "px";
    iframe.style.border = "0";
    iframe.style.display = "block";
    iframe.style.overflow = "hidden";
    iframe.style.background = "transparent";

    wrapper.appendChild(iframe);

    if (script.parentNode) {
        script.parentNode.insertBefore(wrapper, script.nextSibling);
    }

    var lastHeight = minHeight;

    window.addEventListener("message", function (event) {
        if (event.origin !== allowedOrigin) return;

        var data = event.data || {};

        if (data.namespace !== "mortgage-lead-magnet") return;

        if (data.type === "resize") {
            var nextHeight = Number(data.height);

            if (!Number.isFinite(nextHeight)) return;

            nextHeight = Math.max(minHeight, Math.min(nextHeight, maxHeight));

            if (Math.abs(nextHeight - lastHeight) < 8) return;

            lastHeight = nextHeight;
            iframe.style.height = nextHeight + "px";
        }

        if (data.type === "scroll-to-top") {
            try {
                iframe.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            } catch {
                iframe.scrollIntoView();
            }
        }
    });
})();