import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches a render error and says what it was.
 *
 * React unmounts the whole tree when a render throws, which leaves a black
 * page and nothing else — indistinguishable from a build that failed to load,
 * a webview that never started, or an app that hung. That ambiguity cost real
 * time in the desktop shell, where there is no address bar to check and no
 * console open by default.
 *
 * So the error is shown rather than swallowed: the message, where it happened,
 * and a way to copy it. It is not a friendly apology screen, because the person
 * reading it is almost always the person who can fix it.
 */
type State = { error: Error | null; stack: string };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged as well as shown: a webview with devtools open should still get
    // the full trace, and the panel below only has room for the summary.
    console.error("Nuvio crashed while rendering", error, info.componentStack);
    this.setState({ stack: info.componentStack ?? "" });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    const report = `${error.message}\n\n${error.stack ?? ""}\n\nComponent stack:${stack}`;
    return (
      <div className="crash-screen">
        <div>
          <small>SOMETHING BROKE</small>
          <h1>Nuvio stopped drawing this page</h1>
          <p>{error.message || "A render threw with no message."}</p>
          {stack && <pre>{stack.trim().split("\n").slice(0, 6).join("\n")}</pre>}
          <div className="crash-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void navigator.clipboard?.writeText(report)}
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    );
  }
}
