"""In-process job queue for style-transfer requests.

Decouples "accept the request" from "do the (5-30s) work" so a burst of
concurrent students never blocks the event loop or piles up behind a
caller's fixed timeout — they get a job_id back immediately and poll for
completion instead.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable

log = logging.getLogger("style-transfer.jobs")

NUM_WORKERS = min(8, os.cpu_count() or 4)
JOB_TTL_SECONDS = 15 * 60  # evict finished jobs this long after they finish


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | running | done | error
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    result_bytes: bytes | None = None
    meta: dict = field(default_factory=dict)
    error: str | None = None


_jobs: dict[str, Job] = {}
_pending_order: list[str] = []
_queue: asyncio.Queue | None = None
_workers_started = False


def _get_queue() -> asyncio.Queue:
    global _queue
    if _queue is None:
        _queue = asyncio.Queue()
    return _queue


async def _worker(worker_id: int) -> None:
    queue = _get_queue()
    while True:
        job_id, fn = await queue.get()
        job = _jobs.get(job_id)
        if job is None:
            queue.task_done()
            continue
        if job_id in _pending_order:
            _pending_order.remove(job_id)
        job.status = "running"
        job.started_at = time.time()
        try:
            result_bytes, meta = await asyncio.to_thread(fn)
            job.result_bytes = result_bytes
            job.meta = meta
            job.status = "done"
        except Exception as exc:  # noqa: BLE001 -- surfaced to the client via job.error
            log.exception("style job %s failed", job_id)
            job.error = str(exc)
            job.status = "error"
        finally:
            job.finished_at = time.time()
            queue.task_done()


async def _ensure_workers_started() -> None:
    global _workers_started
    if _workers_started:
        return
    _workers_started = True
    loop = asyncio.get_running_loop()
    for i in range(NUM_WORKERS):
        loop.create_task(_worker(i))


def _sweep_old_jobs() -> None:
    now = time.time()
    stale = [
        jid for jid, j in _jobs.items()
        if j.finished_at is not None and (now - j.finished_at) > JOB_TTL_SECONDS
    ]
    for jid in stale:
        _jobs.pop(jid, None)


async def submit(fn: Callable[[], tuple[bytes, dict]]) -> str:
    """Enqueue a job. `fn` is a zero-arg callable that does the blocking
    work and returns (result_bytes, meta_dict); it runs in a worker thread
    so it never blocks the event loop."""
    await _ensure_workers_started()
    _sweep_old_jobs()
    job_id = uuid.uuid4().hex
    _jobs[job_id] = Job(id=job_id)
    _pending_order.append(job_id)
    await _get_queue().put((job_id, fn))
    return job_id


def get_job(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def queue_position(job_id: str) -> int | None:
    """1-based position among still-queued (not yet running) jobs."""
    try:
        return _pending_order.index(job_id) + 1
    except ValueError:
        return None
