from .ble import router as ble_router
from .device import router as device_router
from .instruments import router as instruments_router
from .loadpull import router as load_pull_router
from .motor import router as motor_router
from .servo import router as servo_router
from .test import router as test_router

__all__ = [
    "ble_router", "device_router", "instruments_router", "load_pull_router",
    "motor_router", "servo_router", "test_router",
]
