"""POST /v1/approve-generate-ar

Teacher-side approval endpoint. Given a prepared bundle (model + texture), produce
the final AR manifest the teacher publishes over the realtime socket. The manifest is
what students download on the /ar route.
"""
from __future__ import annotations

import time
import uuid
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ApproveBody(BaseModel):
    roomId: str
    studentId: str
    authorId: str
    modelUrl: str
    textureUrl: Optional[str] = None
    animationName: Optional[str] = None
    label: Optional[str] = None


@router.post("/approve-generate-ar")
def approve_generate_ar(body: ApproveBody):
    manifest = {
        "manifestId": uuid.uuid4().hex,
        "authorId": body.authorId,
        "modelUrl": body.modelUrl,
        "textureUrl": body.textureUrl,
        "animationName": body.animationName,
        "label": body.label,
        "createdAt": int(time.time() * 1000),
    }
    return {
        "ok": True,
        "roomId": body.roomId,
        "studentId": body.studentId,
        "manifest": manifest,
    }
