"""Resume an existing InferFlow run without submitting or charging a new job."""

import argparse
import json
import sys
import time
from pathlib import Path
from urllib.error import URLError


def retry_read(operation, sleep=time.sleep):
    for attempt in range(5):
        try:
            return operation()
        except Exception as error:
            transient = isinstance(error, (URLError, TimeoutError, ConnectionError)) or getattr(error, "status_code", None) in (408, 429, 500, 502, 503, 504)
            if not transient or attempt == 4:
                raise
            sleep(min(30, 2 ** (attempt + 1)))


def resume(client, run_id, output_dir, interval=20, timeout=7200, sleep=time.sleep):
    output_dir.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout
    last_state = None
    while time.monotonic() < deadline:
        status = retry_read(lambda: client.get_run(run_id), sleep)
        (output_dir / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
        state = status.get("status")
        if state != last_state:
            print(f"Status: {state}; progress: {status.get('progress_percent')}", flush=True)
            last_state = state
        if state == "completed":
            outputs = retry_read(lambda: client.list_outputs(run_id), sleep)
            (output_dir / "outputs.json").write_text(json.dumps(outputs, ensure_ascii=False, indent=2), encoding="utf-8")
            video = next((item for item in outputs.get("items", []) if item.get("name") == "video" and item.get("download_url")), None)
            if video is None:
                raise RuntimeError("Completed run has no downloadable video")
            destination = output_dir / "video.mp4"
            retry_read(lambda: client.download_output(video["download_url"], destination), sleep)
            return destination
        if state in {"failed", "canceled", "cancelled", "partial_success"}:
            raise RuntimeError(f"Run ended: {state}; {status.get('error_message') or ''}")
        sleep(interval)
    raise TimeoutError(f"Existing run still pending: {run_id}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--client-dir", type=Path, default=Path.home() / ".agents/skills/inferflow-codex/scripts")
    args = parser.parse_args()
    sys.path.insert(0, str(args.client_dir))
    from config import get_api_key, get_base_url
    from inferflow_client import InferFlowClient
    client = InferFlowClient(api_key=get_api_key(None), base_url=get_base_url(None))
    print(resume(client, args.run_id, args.out_dir))


if __name__ == "__main__":
    main()
