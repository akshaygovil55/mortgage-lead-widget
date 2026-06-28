class MortgageLeadWidget extends HTMLElement {
    connectedCallback() {
        if (this._mounted) return;
        this._mounted = true;

        const src =
            this.getAttribute("src") ||
            "https://mortgage-lead-widget.vercel.app/";

        const minHeight = Number(this.getAttribute("min-height") || 420);
        const maxHeight = Number(this.getAttribute("max-height") || 5000);
        const widgetOrigin = new URL(src).origin;
        const namespace = "mortgage-lead-magnet";

        this.style.display = "block";
        this.style.width = "100%";
        this.style.minHeight = `${minHeight}px`;
        this.style.overflow = "hidden";

        const iframe = document.createElement("iframe");
        iframe.src = src;
        iframe.title = "Mortgage Estimate";
        iframe.loading = "lazy";
        iframe.scrolling = "no";

        iframe.style.width = "100%";
        iframe.style.height = `${minHeight}px`;
        iframe.style.minHeight = `${minHeight}px`;
        iframe.style.border = "0";
        iframe.style.display = "block";
        iframe.style.overflow = "hidden";
        iframe.style.background = "transparent";

        this.appendChild(iframe);

        this._onMessage = (event) => {
            if (event.origin !== widgetOrigin) return;
            if (event.source !== iframe.contentWindow) return;

            const data = event.data || {};
            if (data.namespace !== namespace) return;

            if (data.type === "resize") {
                const nextHeight = Number(data.height);
                if (!Number.isFinite(nextHeight)) return;

                const safeHeight = Math.max(
                    minHeight,
                    Math.min(nextHeight, maxHeight)
                );

                iframe.style.height = `${safeHeight}px`;
                this.style.height = `${safeHeight}px`;
                this.style.minHeight = `${safeHeight}px`;
            }

            if (data.type === "scroll-to-top") {
                this.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            }
        };

        window.addEventListener("message", this._onMessage);
    }

    disconnectedCallback() {
        if (this._onMessage) {
            window.removeEventListener("message", this._onMessage);
        }
    }
}

customElements.define("mortgage-lead-widget", MortgageLeadWidget);