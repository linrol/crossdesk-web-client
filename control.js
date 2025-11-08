(function () {
  const ControlType = {
    mouse: 0,
    keyboard: 1,
    audio_capture: 2,
    host_infomation: 3,
    display_id: 4,
  };

  const MouseFlag = {
    move: 0,
    left_down: 1,
    left_up: 2,
    right_down: 3,
    right_up: 4,
    middle_down: 5,
    middle_up: 6,
    wheel_vertical: 7,
    wheel_horizontal: 8,
  };

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const isTextInput = (el) => {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag !== "input") return false;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
  };

  class ControlManager {
    constructor() {
      this.dataChannel = null;
      this.elements = {
        video: document.getElementById("video"),
        dataLog: document.getElementById("data-channel"),
        mediaContainer: document.getElementById("media"),
        videoContainer: document.getElementById("video-container"),
        virtualMouse: document.getElementById("virtual-mouse"),
        virtualLeftBtn: document.getElementById("virtual-left-btn"),
        virtualRightBtn: document.getElementById("virtual-right-btn"),
        virtualWheel: document.getElementById("virtual-wheel"),
        virtualTouchpad: null,
        virtualDragHandle: document.getElementById("virtual-mouse-drag-handle"),
        mobileModeSelector: document.getElementById("mobile-mode-selector"),
        mouseControlMode: document.getElementById("mouse-control-mode"),
      };

      this.state = {
        pointerLocked: false,
        normalizedPos: { x: 0.5, y: 0.5 },
        lastPointerPos: null,
        lastWheelAt: 0,
        touchpadStart: null,
        draggingVirtualMouse: false,
        dragOffset: { x: 0, y: 0 },
        pointerLockToastTimer: null,
        videoRect: null,
        gestureActive: false,
        gestureButton: null,
        gestureStart: null,
        isMobile: false,
        mobileControlMode: "absolute", // "absolute" or "relative"
        touchActive: false,
        touchStartPos: null,
        touchLastPos: null,
      };

      this.virtualWheelTimer = null;

      this.onPointerLockChange = this.onPointerLockChange.bind(this);
      this.onPointerLockError = this.onPointerLockError.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onPointerUp = this.onPointerUp.bind(this);
      this.onPointerCancel = this.onPointerCancel.bind(this);
      this.onWheel = this.onWheel.bind(this);

      this.onTouchStartFallback = this.onTouchStartFallback.bind(this);
      this.onTouchMoveFallback = this.onTouchMoveFallback.bind(this);
      this.onTouchEndFallback = this.onTouchEndFallback.bind(this);

      this.onVirtualWheelStart = this.onVirtualWheelStart.bind(this);
      this.onVirtualWheelEnd = this.onVirtualWheelEnd.bind(this);
      this.onVirtualLeftStart = this.onVirtualLeftStart.bind(this);
      this.onVirtualRightStart = this.onVirtualRightStart.bind(this);
      this.onVirtualButtonMove = this.onVirtualButtonMove.bind(this);
      this.onVirtualButtonEnd = this.onVirtualButtonEnd.bind(this);

      this.onDragHandleTouchStart = this.onDragHandleTouchStart.bind(this);
      this.onDragHandleTouchMove = this.onDragHandleTouchMove.bind(this);
      this.onDragHandleTouchEnd = this.onDragHandleTouchEnd.bind(this);
      this.onDragHandleClick = this.onDragHandleClick.bind(this);

      this.init();
    }

    init() {
      const { video } = this.elements;
      if (!video) {
        console.warn("CrossDeskControl: video element not found");
        return;
      }

      video.style.pointerEvents = "auto";
      video.tabIndex = 0;

      this.bindPointerLockEvents();
      this.bindPointerListeners();
      this.bindKeyboardListeners();
      this.setupVirtualMouse();
    }

    setDataChannel(channel) {
      this.dataChannel = channel;
    }

    isChannelOpen() {
      return this.dataChannel && this.dataChannel.readyState === "open";
    }

    send(action) {
      if (!this.isChannelOpen()) return false;
      try {
        const payload = JSON.stringify(action);
        this.dataChannel.send(payload);
        this.logDataChannel(payload);
        return true;
      } catch (err) {
        console.error("CrossDeskControl: failed to send action", err);
        return false;
      }
    }

    sendMouseAction({ x, y, flag, scroll = 0 }) {
      const numericFlag =
        typeof flag === "string" ? MouseFlag[flag] ?? MouseFlag.move : flag | 0;

      const action = {
        type: ControlType.mouse,
        mouse: {
          x: clamp01(x),
          y: clamp01(y),
          s: scroll | 0,
          flag: numericFlag,
        },
      };

      this.send(action);
    }

    sendKeyboardAction(keyValue, isDown) {
      const action = {
        type: ControlType.keyboard,
        keyboard: {
          key_value: keyValue | 0,
          flag: isDown ? 0 : 1,
        },
      };
      this.send(action);
    }

    sendAudioCapture(enabled) {
      const action = {
        type: ControlType.audio_capture,
        audio_capture: !!enabled,
      };
      this.send(action);
    }

    sendDisplayId(id) {
      const action = {
        type: ControlType.display_id,
        display_id: id | 0,
      };
      this.send(action);
    }

    sendRawMessage(raw) {
      if (!this.isChannelOpen()) return false;
      try {
        this.dataChannel.send(raw);
        this.logDataChannel(raw);
        return true;
      } catch (err) {
        console.error("CrossDeskControl: failed to send raw message", err);
        return false;
      }
    }

    logDataChannel(text) {
      const dataLog = document.getElementById("data-channel");
      if (!dataLog) return;
      // Only log if debug mode is enabled
      const debugMode = localStorage.getItem("crossdesk-debug") === "true";
      if (debugMode) {
      dataLog.textContent += `> ${text}\n`;
      dataLog.scrollTop = dataLog.scrollHeight;
      }
    }

    bindPointerLockEvents() {
      document.addEventListener("pointerlockchange", this.onPointerLockChange);
      document.addEventListener("pointerlockerror", this.onPointerLockError);
      document.addEventListener("keydown", (event) => {
        if (event.ctrlKey && event.key === "Escape") {
          document.exitPointerLock?.();
        }
      });
    }

    onPointerLockChange() {
      this.state.pointerLocked = document.pointerLockElement === this.elements.video;
      if (this.state.pointerLocked) {
        this.state.videoRect = this.elements.video?.getBoundingClientRect() ?? null;
      } else {
        this.state.videoRect = null;
        this.showPointerLockToast(
          "已退出鼠标锁定，按 Esc 或点击视频重新锁定（释放可按 Ctrl+Esc）",
          3000
        );
      }
      if (this.elements.dataLog) {
        this.elements.dataLog.textContent += `[pointerlock ${
          this.state.pointerLocked ? "entered" : "exited"
        }]\n`;
        this.elements.dataLog.scrollTop = this.elements.dataLog.scrollHeight;
      }
    }

    onPointerLockError() {
      this.showPointerLockToast("鼠标锁定失败", 2500);
    }

    bindPointerListeners() {
      const { video } = this.elements;
      if (!video) return;

      try {
        video.style.touchAction = "none";
      } catch (err) {}

      video.addEventListener("pointerdown", this.onPointerDown, {
        passive: false,
      });
      document.addEventListener("pointermove", this.onPointerMove, {
        passive: false,
      });
      document.addEventListener("pointerup", this.onPointerUp, {
        passive: false,
      });
      document.addEventListener("pointercancel", this.onPointerCancel);
      video.addEventListener("wheel", this.onWheel, { passive: false });

      if (!window.PointerEvent) {
        video.addEventListener("touchstart", this.onTouchStartFallback, {
          passive: false,
        });
        document.addEventListener("touchmove", this.onTouchMoveFallback, {
          passive: false,
        });
        document.addEventListener("touchend", this.onTouchEndFallback, {
          passive: false,
        });
        document.addEventListener("touchcancel", this.onTouchEndFallback, {
          passive: false,
        });
      }
    }

    onPointerDown(event) {
      const button = typeof event.button === "number" ? event.button : 0;
      if (button < 0) return;
      
      // 移动端模式下，触摸视频区域不触发点击事件，只移动鼠标位置
      if (this.state.isMobile && event.pointerType === "touch") {
        event.preventDefault?.();
        this.ensureVideoRect();
        if (this.state.videoRect && this.isInsideVideo(event.clientX, event.clientY)) {
          // 模式1：指哪打哪 - 直接设置鼠标位置
          if (this.state.mobileControlMode === "absolute") {
            this.updateNormalizedFromClient(event.clientX, event.clientY);
            this.sendMouseAction({
              x: this.state.normalizedPos.x,
              y: this.state.normalizedPos.y,
              flag: MouseFlag.move,
            });
          } else {
            // 模式2：增量模式 - 记录起始位置
            this.state.touchActive = true;
            this.state.touchStartPos = { x: event.clientX, y: event.clientY };
            this.state.touchLastPos = { x: event.clientX, y: event.clientY };
          }
        }
        this.elements.video?.setPointerCapture?.(event.pointerId ?? 0);
        return;
      }

      event.preventDefault?.();

      this.state.lastPointerPos = { x: event.clientX, y: event.clientY };
      this.ensureVideoRect();
      if (this.state.videoRect && this.isInsideVideo(event.clientX, event.clientY)) {
        this.updateNormalizedFromClient(event.clientX, event.clientY);
        this.requestPointerLock();
      }

      this.elements.video?.setPointerCapture?.(event.pointerId ?? 0);
      this.sendMouseAction({
        x: this.state.normalizedPos.x,
        y: this.state.normalizedPos.y,
        flag: this.buttonToFlag(button, true),
      });
    }

    onPointerMove(event) {
      // 移动端增量模式处理
      if (this.state.isMobile && event.pointerType === "touch" && this.state.touchActive && this.state.mobileControlMode === "relative") {
        event.preventDefault?.();
        this.ensureVideoRect();
        if (!this.state.videoRect || !this.state.touchLastPos) return;

        const deltaX = event.clientX - this.state.touchLastPos.x;
        const deltaY = event.clientY - this.state.touchLastPos.y;

        // 计算增量（相对于视频尺寸）
        const deltaXNormalized = deltaX / this.state.videoRect.width;
        const deltaYNormalized = deltaY / this.state.videoRect.height;

        // 更新鼠标位置（增量模式）
        this.state.normalizedPos.x = clamp01(this.state.normalizedPos.x + deltaXNormalized);
        this.state.normalizedPos.y = clamp01(this.state.normalizedPos.y + deltaYNormalized);

        this.sendMouseAction({
          x: this.state.normalizedPos.x,
          y: this.state.normalizedPos.y,
          flag: MouseFlag.move,
        });

        this.state.touchLastPos = { x: event.clientX, y: event.clientY };
        return;
      }

      // 移动端指哪打哪模式处理
      if (this.state.isMobile && event.pointerType === "touch" && this.state.mobileControlMode === "absolute") {
        event.preventDefault?.();
        this.ensureVideoRect();
        if (!this.state.videoRect || !this.isInsideVideo(event.clientX, event.clientY)) return;

        this.updateNormalizedFromClient(event.clientX, event.clientY);
        this.sendMouseAction({
          x: this.state.normalizedPos.x,
          y: this.state.normalizedPos.y,
          flag: MouseFlag.move,
        });
        return;
      }

      // 桌面端处理
      if (!this.state.pointerLocked && !this.state.lastPointerPos) return;

      const movementX = this.state.pointerLocked
        ? event.movementX
        : event.clientX - (this.state.lastPointerPos?.x ?? event.clientX);
      const movementY = this.state.pointerLocked
        ? event.movementY
        : event.clientY - (this.state.lastPointerPos?.y ?? event.clientY);

      if (!this.state.pointerLocked) {
        this.state.lastPointerPos = { x: event.clientX, y: event.clientY };
      }

      this.ensureVideoRect();
      if (!this.state.videoRect) return;

      if (this.state.pointerLocked) {
        this.state.normalizedPos.x = clamp01(
          this.state.normalizedPos.x + movementX / this.state.videoRect.width
        );
        this.state.normalizedPos.y = clamp01(
          this.state.normalizedPos.y + movementY / this.state.videoRect.height
        );
        this.sendMouseAction({
          x: this.state.normalizedPos.x,
          y: this.state.normalizedPos.y,
          flag: MouseFlag.move,
        });
        return;
      }

      if (!this.isInsideVideo(event.clientX, event.clientY)) return;
      const x = (event.clientX - this.state.videoRect.left) /
        this.state.videoRect.width;
      const y = (event.clientY - this.state.videoRect.top) /
        this.state.videoRect.height;
      this.state.normalizedPos = { x: clamp01(x), y: clamp01(y) };
      this.sendMouseAction({
        x: this.state.normalizedPos.x,
        y: this.state.normalizedPos.y,
        flag: MouseFlag.move,
      });
    }

    onPointerUp(event) {
      // 移动端模式下，触摸结束不触发点击事件
      if (this.state.isMobile && event.pointerType === "touch") {
        this.elements.video?.releasePointerCapture?.(event.pointerId ?? 0);
        this.state.touchActive = false;
        this.state.touchStartPos = null;
        this.state.touchLastPos = null;
        return;
      }

      const button = typeof event.button === "number" ? event.button : 0;
      this.elements.video?.releasePointerCapture?.(event.pointerId ?? 0);
      this.state.lastPointerPos = null;
      this.sendMouseAction({
        x: this.state.normalizedPos.x,
        y: this.state.normalizedPos.y,
        flag: this.buttonToFlag(button, false),
      });
    }

    onPointerCancel() {
      this.state.lastPointerPos = null;
      // 清理移动端触摸状态
      if (this.state.isMobile) {
        this.state.touchActive = false;
        this.state.touchStartPos = null;
        this.state.touchLastPos = null;
      }
    }

    onWheel(event) {
      const now = Date.now();
      if (now - this.state.lastWheelAt < 50) return;
      this.state.lastWheelAt = now;

      this.ensureVideoRect();
      if (!this.state.videoRect) return;

      let coords = this.state.normalizedPos;
      if (!this.state.pointerLocked) {
        if (!this.isInsideVideo(event.clientX, event.clientY)) return;
        coords = {
          x: (event.clientX - this.state.videoRect.left) /
            this.state.videoRect.width,
          y: (event.clientY - this.state.videoRect.top) /
            this.state.videoRect.height,
        };
      }

      this.sendMouseAction({
        x: coords.x,
        y: coords.y,
        flag: event.deltaY === 0 ? MouseFlag.wheel_horizontal : MouseFlag.wheel_vertical,
        scroll: event.deltaY || event.deltaX,
      });
      event.preventDefault();
    }

    onTouchStartFallback(event) {
      if (!event.touches?.length) return;
      const touch = event.touches[0];
      event.preventDefault();
      
      // 移动端模式下，触摸视频区域不触发点击事件
      this.ensureVideoRect();
      if (this.state.videoRect && this.isInsideVideo(touch.clientX, touch.clientY)) {
        if (this.state.mobileControlMode === "absolute") {
          // 模式1：指哪打哪
          this.updateNormalizedFromClient(touch.clientX, touch.clientY);
          this.sendMouseAction({
            x: this.state.normalizedPos.x,
            y: this.state.normalizedPos.y,
            flag: MouseFlag.move,
          });
        } else {
          // 模式2：增量模式
          this.state.touchActive = true;
          this.state.touchStartPos = { x: touch.clientX, y: touch.clientY };
          this.state.touchLastPos = { x: touch.clientX, y: touch.clientY };
        }
      }
    }

    onTouchMoveFallback(event) {
      if (!event.touches?.length) return;
      const touch = event.touches[0];
      event.preventDefault();
      
      this.ensureVideoRect();
      if (!this.state.videoRect) return;

      if (this.state.mobileControlMode === "absolute") {
        // 模式1：指哪打哪
        if (this.isInsideVideo(touch.clientX, touch.clientY)) {
          this.updateNormalizedFromClient(touch.clientX, touch.clientY);
          this.sendMouseAction({
            x: this.state.normalizedPos.x,
            y: this.state.normalizedPos.y,
            flag: MouseFlag.move,
          });
        }
      } else if (this.state.touchActive && this.state.touchLastPos) {
        // 模式2：增量模式
        const deltaX = touch.clientX - this.state.touchLastPos.x;
        const deltaY = touch.clientY - this.state.touchLastPos.y;

        const deltaXNormalized = deltaX / this.state.videoRect.width;
        const deltaYNormalized = deltaY / this.state.videoRect.height;

        this.state.normalizedPos.x = clamp01(this.state.normalizedPos.x + deltaXNormalized);
        this.state.normalizedPos.y = clamp01(this.state.normalizedPos.y + deltaYNormalized);

        this.sendMouseAction({
          x: this.state.normalizedPos.x,
          y: this.state.normalizedPos.y,
          flag: MouseFlag.move,
        });

        this.state.touchLastPos = { x: touch.clientX, y: touch.clientY };
      }
    }

    onTouchEndFallback(event) {
      // 移动端模式下，触摸结束不触发点击事件
      this.state.touchActive = false;
      this.state.touchStartPos = null;
      this.state.touchLastPos = null;
    }

    buttonToFlag(button, isDown) {
      const mapping = {
        0: { down: MouseFlag.left_down, up: MouseFlag.left_up },
        1: { down: MouseFlag.middle_down, up: MouseFlag.middle_up },
        2: { down: MouseFlag.right_down, up: MouseFlag.right_up },
      };
      const record = mapping[button] || mapping[0];
      return isDown ? record.down : record.up;
    }

    requestPointerLock() {
      try {
        this.elements.video?.requestPointerLock?.();
      } catch (err) {
        console.warn("CrossDeskControl: requestPointerLock failed", err);
      }
    }

    ensureVideoRect() {
      const { video } = this.elements;
      if (!video) return;
      this.state.videoRect = video.getBoundingClientRect();
    }

    isInsideVideo(clientX, clientY) {
      const rect = this.state.videoRect;
      if (!rect) return false;
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }

    updateNormalizedFromClient(clientX, clientY) {
      if (!this.state.videoRect) return;
      this.state.normalizedPos = {
        x: clamp01((clientX - this.state.videoRect.left) / this.state.videoRect.width),
        y: clamp01((clientY - this.state.videoRect.top) / this.state.videoRect.height),
      };
    }

    bindKeyboardListeners() {
      document.addEventListener("keydown", (event) => {
        if (!this.isChannelOpen()) return;
        if (event.repeat) return;
        if (isTextInput(event.target)) return;
        this.sendKeyboardAction(event.keyCode ?? 0, true);
      });

      document.addEventListener("keyup", (event) => {
        if (!this.isChannelOpen()) return;
        if (isTextInput(event.target)) return;
        this.sendKeyboardAction(event.keyCode ?? 0, false);
      });
    }

    setupVirtualMouse() {
      const isDesktop = window.matchMedia(
        "(hover: hover) and (pointer: fine)"
      ).matches;

      this.state.isMobile = !isDesktop;

      if (isDesktop) {
        if (this.elements.virtualMouse) {
          this.elements.virtualMouse.style.pointerEvents = "none";
        }
        if (this.elements.mobileModeSelector) {
          this.elements.mobileModeSelector.style.display = "none";
        }
        return;
      }

      // 显示移动端模式选择器
      if (this.elements.mobileModeSelector) {
        this.elements.mobileModeSelector.style.display = "flex";
      }

      // 绑定模式切换事件
      if (this.elements.mouseControlMode) {
        this.elements.mouseControlMode.addEventListener("change", (event) => {
          this.state.mobileControlMode = event.target.value;
        });
        this.state.mobileControlMode = this.elements.mouseControlMode.value;
      }

      this.elements.virtualLeftBtn?.addEventListener("touchstart", this.onVirtualLeftStart, { passive: false });
      this.elements.virtualRightBtn?.addEventListener("touchstart", this.onVirtualRightStart, { passive: false });
      document.addEventListener("touchmove", this.onVirtualButtonMove, { passive: false });
      document.addEventListener("touchend", this.onVirtualButtonEnd, { passive: false });
      document.addEventListener("touchcancel", this.onVirtualButtonEnd, { passive: false });

      this.elements.virtualWheel?.addEventListener(
        "touchstart",
        this.onVirtualWheelStart,
        { passive: false }
      );
      this.elements.virtualWheel?.addEventListener(
        "touchend",
        this.onVirtualWheelEnd,
        { passive: false }
      );
      this.elements.virtualWheel?.addEventListener(
        "touchcancel",
        this.onVirtualWheelEnd,
        { passive: false }
      );

      this.bindVirtualMouseDragging();
    }

    onVirtualWheelStart(event) {
      event.preventDefault();
      this.emitVirtualWheel();
      this.virtualWheelTimer = setInterval(() => this.emitVirtualWheel(), 100);
    }

    onVirtualWheelEnd(event) {
      event.preventDefault();
      if (this.virtualWheelTimer) {
        clearInterval(this.virtualWheelTimer);
        this.virtualWheelTimer = null;
      }
    }

    emitVirtualWheel() {
      this.sendMouseAction({
        x: this.state.normalizedPos.x,
        y: this.state.normalizedPos.y,
        flag: MouseFlag.wheel_vertical,
        scroll: -20,
      });
    }

    onVirtualLeftStart(event) {
      const touch = event.touches?.[0];
      if (!touch) return;
      event.preventDefault();
      this.ensureVideoRect();
      this.state.gestureActive = true;
      this.state.gestureButton = { down: MouseFlag.left_down, up: MouseFlag.left_up };
      this.state.gestureStart = {
        x: touch.clientX,
        y: touch.clientY,
        normalizedX: this.state.normalizedPos.x,
        normalizedY: this.state.normalizedPos.y,
      };
      // 按下时设置为蓝色
      if (this.elements.virtualLeftBtn) {
        this.elements.virtualLeftBtn.style.backgroundColor = "var(--primary-color)";
        this.elements.virtualLeftBtn.style.color = "#fff";
      }
      this.sendMouseAction({
        x: this.state.normalizedPos.x,
        y: this.state.normalizedPos.y,
        flag: MouseFlag.left_down,
      });
    }

    onVirtualRightStart(event) {
      const touch = event.touches?.[0];
      if (!touch) return;
      event.preventDefault();
      this.ensureVideoRect();
      this.state.gestureActive = true;
      this.state.gestureButton = { down: MouseFlag.right_down, up: MouseFlag.right_up };
      this.state.gestureStart = {
        x: touch.clientX,
        y: touch.clientY,
        normalizedX: this.state.normalizedPos.x,
        normalizedY: this.state.normalizedPos.y,
      };
      // 按下时设置为蓝色
      if (this.elements.virtualRightBtn) {
        this.elements.virtualRightBtn.style.backgroundColor = "var(--primary-color)";
        this.elements.virtualRightBtn.style.color = "#fff";
      }
      this.sendMouseAction({
        x: this.state.normalizedPos.x,
        y: this.state.normalizedPos.y,
        flag: MouseFlag.right_down,
      });
    }

    onVirtualButtonMove(event) {
      if (!this.state.gestureActive || !this.state.gestureStart) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      event.preventDefault();
      this.ensureVideoRect();
      if (!this.state.videoRect) return;

      const sensitivity = 2;
      const deltaX = touch.clientX - this.state.gestureStart.x;
      const deltaY = touch.clientY - this.state.gestureStart.y;
      const newX = this.state.gestureStart.normalizedX + (deltaX / this.state.videoRect.width) * sensitivity;
      const newY = this.state.gestureStart.normalizedY + (deltaY / this.state.videoRect.height) * sensitivity;

      this.state.normalizedPos = { x: clamp01(newX), y: clamp01(newY) };
      this.sendMouseAction({ x: this.state.normalizedPos.x, y: this.state.normalizedPos.y, flag: MouseFlag.move });
    }

    onVirtualButtonEnd(event) {
      if (!this.state.gestureActive) return;
      event.preventDefault?.();
      const upFlag = this.state.gestureButton?.up ?? MouseFlag.left_up;
      this.sendMouseAction({ x: this.state.normalizedPos.x, y: this.state.normalizedPos.y, flag: upFlag });
      
      // 释放时恢复为白色
      if (upFlag === MouseFlag.left_up && this.elements.virtualLeftBtn) {
        this.elements.virtualLeftBtn.style.backgroundColor = "rgba(255, 255, 255, 0.9)";
        this.elements.virtualLeftBtn.style.color = "#333";
      } else if (upFlag === MouseFlag.right_up && this.elements.virtualRightBtn) {
        this.elements.virtualRightBtn.style.backgroundColor = "rgba(255, 255, 255, 0.9)";
        this.elements.virtualRightBtn.style.color = "#333";
      }
      
      this.state.gestureActive = false;
      this.state.gestureButton = null;
      this.state.gestureStart = null;
    }

    bindVirtualMouseDragging() {
      const { virtualMouse, virtualDragHandle, videoContainer } = this.elements;
      if (!virtualMouse || !virtualDragHandle || !videoContainer) return;

      virtualDragHandle.addEventListener("touchstart", this.onDragHandleTouchStart, {
        passive: false,
      });
      virtualDragHandle.addEventListener("click", this.onDragHandleClick);
      document.addEventListener("touchmove", this.onDragHandleTouchMove, {
        passive: false,
      });
      document.addEventListener("touchend", this.onDragHandleTouchEnd, {
        passive: false,
      });
      document.addEventListener("touchcancel", this.onDragHandleTouchEnd, {
        passive: false,
      });
    }

    onDragHandleTouchStart(event) {
      const touch = event.touches?.[0];
      if (!touch || !this.elements.virtualMouse) return;
      event.preventDefault();
      const rect = this.elements.virtualMouse.getBoundingClientRect();
      this.state.draggingVirtualMouse = true;
      // 添加dragging类以禁用transition
      this.elements.virtualMouse.classList.add("dragging");
      this.state.dragOffset = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }

    onDragHandleTouchMove(event) {
      if (!this.state.draggingVirtualMouse) return;
      const touch = event.touches?.[0];
      if (!touch || !this.elements.videoContainer || !this.elements.virtualMouse)
        return;
      event.preventDefault();

      const containerRect = this.elements.videoContainer.getBoundingClientRect();
      // 直接使用触摸位置，减去偏移量
      let newX = touch.clientX - this.state.dragOffset.x - containerRect.left;
      let newY = touch.clientY - this.state.dragOffset.y - containerRect.top;

      const maxX = Math.max(
        0,
        containerRect.width - this.elements.virtualMouse.offsetWidth
      );
      const maxY = Math.max(
        0,
        containerRect.height - this.elements.virtualMouse.offsetHeight
      );

      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      // 直接更新位置，不使用requestAnimationFrame以保持跟手
      this.elements.virtualMouse.style.left = `${newX}px`;
      this.elements.virtualMouse.style.top = `${newY}px`;
      this.elements.virtualMouse.style.bottom = "auto";
      this.elements.virtualMouse.style.transform = "none";
    }

    onDragHandleTouchEnd() {
      this.state.draggingVirtualMouse = false;
      // 移除dragging类以恢复transition
      if (this.elements.virtualMouse) {
        this.elements.virtualMouse.classList.remove("dragging");
      }
    }

    onDragHandleClick(event) {
      event.stopPropagation();
      this.elements.virtualMouse?.classList.toggle("minimized");
    }

    showPointerLockToast(text, duration = 2500) {
      let toast = document.getElementById("pointerlock-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "pointerlock-toast";
        Object.assign(toast.style, {
          position: "fixed",
          left: "50%",
          bottom: "24px",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.75)",
          color: "#fff",
          padding: "8px 12px",
          borderRadius: "6px",
          fontSize: "13px",
          zIndex: "9999",
          pointerEvents: "none",
          opacity: "1",
          transition: "opacity 0.2s",
        });
        document.body.appendChild(toast);
      }
      toast.textContent = text;
      toast.style.opacity = "1";
      if (this.state.pointerLockToastTimer) {
        clearTimeout(this.state.pointerLockToastTimer);
      }
      this.state.pointerLockToastTimer = setTimeout(() => {
        toast.style.opacity = "0";
        this.state.pointerLockToastTimer = null;
      }, duration);
    }

    handleExternalMouseEvent(event) {
      if (!event || !event.type) return;
      switch (event.type) {
        case "mousedown":
          this.onPointerDown(event);
          break;
        case "mouseup":
          this.onPointerUp(event);
          break;
        case "mousemove":
          this.onPointerMove(event);
          break;
        case "wheel":
          this.onWheel(event);
          break;
        default:
          break;
      }
    }
  }

  const control = new ControlManager();

  window.CrossDeskControl = control;
  window.sendRemoteActionAt = (x, y, flag, scroll) =>
    control.sendMouseAction({ x, y, flag, scroll });
  window.sendMouseEvent = (event) => control.handleExternalMouseEvent(event);
})();

