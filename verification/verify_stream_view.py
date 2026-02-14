from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console messages
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

        try:
            print("Navigating to http://localhost:5173")
            page.goto("http://localhost:5173", timeout=60000)
            print("Navigated")
        except Exception as e:
            print(f"Navigation failed: {e}")
            browser.close()
            return

        # Take a screenshot to see what's happening
        page.screenshot(path="verification/initial_load.png")

        # Wait for StreamView to load
        # Since I modified App.tsx to start in streaming state, it should load StreamView.

        try:
            print("Waiting for .dock-timer")
            page.wait_for_selector(".dock-timer", timeout=10000)
            print("Found .dock-timer")
        except Exception as e:
            print(f"Did not find .dock-timer: {e}")
            page.screenshot(path="verification/failed_stream_view.png")
            browser.close()
            return

        # Wait a bit for timer to update and UI to stabilize
        page.wait_for_timeout(2000)

        # Click on 'Network Statistics' button to open the window
        # The button has title="Network Statistics" and inside dock-left
        try:
            print("Clicking Network Statistics")
            # Wait for button
            page.wait_for_selector('button[title="Network Statistics"]', timeout=5000)
            page.click('button[title="Network Statistics"]')
            print("Clicked Network Statistics")
            page.wait_for_timeout(1000) # Wait for window to open
        except Exception as e:
            print(f"Failed to click Network Statistics: {e}")

        page.screenshot(path="verification/stream_view.png")
        browser.close()

if __name__ == "__main__":
    run()
