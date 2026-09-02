"""Device-under-test command routes, one module per protocol.

Mounted as `/device/...` for LoRa and `/device/lte/...` for LTE.
"""

from fastapi import APIRouter

from .info import router as _info_router
from .lora import router as _lora_router
from .lte import router as _lte_router

router = APIRouter(prefix="/device", tags=["device"])
router.include_router(_info_router)
router.include_router(_lora_router)
router.include_router(_lte_router)

__all__ = ["router"]
