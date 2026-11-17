"""Device-under-test command routes, one module per protocol.

Mounted as `/device/...` for LoRa, `/device/lte/...` for LTE and
`/device/ble/...` for the BLE radio tests.
"""

from fastapi import APIRouter

from .ble import router as _ble_router
from .info import router as _info_router
from .lora import router as _lora_router
from .lte import router as _lte_router

router = APIRouter(prefix="/device", tags=["device"])
router.include_router(_info_router)
router.include_router(_lora_router)
router.include_router(_lte_router)
router.include_router(_ble_router)

__all__ = ["router"]
