import { showMessage, openTab } from "siyuan";
import { PomodoroRecordManager } from "../utils/pomodoroRecord";
import { readReminderData, writeReminderData, getBlockByID, openBlock } from "../api";
import { t } from "../utils/i18n";


export class PomodoroTimer {
    private reminder: any;
    private settings: any;
    private container: HTMLElement;
    private timeDisplay: HTMLElement;
    private statusDisplay: HTMLElement;
    private progressBar: HTMLElement;
    private startPauseBtn: HTMLElement;
    private stopBtn: HTMLElement;
    private circularProgress: HTMLElement;
    private expandToggleBtn: HTMLElement;
    private statsContainer: HTMLElement;
    private todayFocusDisplay: HTMLElement;
    private weekFocusDisplay: HTMLElement;
    private modeToggleBtn: HTMLElement;
    private minimizeBtn: HTMLElement;
    private soundControlBtn: HTMLElement; // 新增：声音控制按钮
    private volumeSlider: HTMLElement; // 新增：音量滑块
    private volumeContainer: HTMLElement; // 新增：音量容器
    private minimizedView: HTMLElement;
    private minimizedIcon: HTMLElement;
    private minimizedBg: HTMLElement;
    private minimizedOverlay: HTMLElement;
    private restoreBtn: HTMLElement;
    private fullscreenBtn: HTMLElement; // 新增：全屏模式按钮
    private exitFullscreenBtn: HTMLElement; // 新增：退出全屏按钮

    private isRunning: boolean = false;
    private isPaused: boolean = false;
    private isWorkPhase: boolean = true;
    private isLongBreak: boolean = false;
    private isCountUp: boolean = false;
    private isBackgroundAudioMuted: boolean = false; // 新增：背景音静音状态
    private backgroundVolume: number = 1; // 新增：背景音音量
    private timeLeft: number = 0; // 倒计时剩余时间
    private timeElapsed: number = 0; // 正计时已用时间
    private breakTimeLeft: number = 0; // 休息时间剩余
    private totalTime: number = 0;
    private completedPomodoros: number = 0; // 完成的番茄数量
    private timer: number = null;
    private isExpanded: boolean = true;
    private isMinimized: boolean = false;
    private startTime: number = 0; // 记录开始时间
    private pausedTime: number = 0; // 记录暂停时累计的时间
    private lastUpdateTime: number = 0; // 记录上次更新的时间

    // 新增：当前阶段的原始设定时长（用于统计）
    private currentPhaseOriginalDuration: number = 0; // 当前阶段的原始设定时长（分钟）
    // 新增：自动模式相关属性
    private autoMode: boolean = false; // 自动模式状态
    private longBreakInterval: number = 4; // 长休息间隔
    private autoTransitionTimer: number = null; // 自动切换定时器

    private workAudio: HTMLAudioElement = null;
    private breakAudio: HTMLAudioElement = null;
    private longBreakAudio: HTMLAudioElement = null;
    private workEndAudio: HTMLAudioElement = null; // 工作结束提示音
    private breakEndAudio: HTMLAudioElement = null; // 休息结束提示音
    private recordManager: PomodoroRecordManager;
    private audioInitialized: boolean = false;
    private audioInitPromise: Promise<void> | null = null;
    private audioUnlockHandler: ((event: Event) => void) | null = null;

    private isWindowClosed: boolean = false; // 新增：窗口关闭状态标记

    // 随机提示音相关
    private randomNotificationTimer: number = null;
    private randomNotificationSounds: HTMLAudioElement[] = [];
    private randomNotificationEnabled: boolean = false;
    private randomNotificationEndSound: HTMLAudioElement = null;

    private systemNotificationEnabled: boolean = true; // 新增：系统弹窗开关
    private randomNotificationSystemNotificationEnabled: boolean = true; // 新增：随机提示音系统通知开关

    private isFullscreen: boolean = false; // 新增：全屏模式状态
    private escapeKeyHandler: ((e: KeyboardEvent) => void) | null = null; // 新增：ESC键监听器

    constructor(reminder: any, settings: any, isCountUp: boolean = false, inheritState?: any) {
        this.reminder = reminder;
        this.settings = settings;
        this.isCountUp = isCountUp; // 设置计时模式
        this.timeLeft = settings.workDuration * 60;
        this.totalTime = this.timeLeft;
        this.recordManager = PomodoroRecordManager.getInstance();

        // 初始化当前阶段的原始时长（分钟）
        this.currentPhaseOriginalDuration = settings.workDuration;

        // 初始化声音设置
        this.isBackgroundAudioMuted = settings.backgroundAudioMuted || false;
        this.backgroundVolume = Math.max(0, Math.min(1, settings.backgroundVolume || 0.5));

        // 初始化系统弹窗设置
        this.systemNotificationEnabled = settings.systemNotification !== false;

        // 初始化随机提示音设置
        this.randomNotificationEnabled = settings.randomNotificationEnabled || false;
        this.randomNotificationSystemNotificationEnabled = settings.randomNotificationSystemNotification !== false; // 新增

        // 初始化自动模式设置
        this.autoMode = settings.autoMode || false;
        this.longBreakInterval = Math.max(1, settings.longBreakInterval || 4);

        // 初始化系统弹窗功能
        this.initSystemNotification();

        // 在用户首次交互时解锁音频播放
        this.attachAudioUnlockListeners();

        // 如果有继承状态，应用继承的状态
        if (inheritState && inheritState.isRunning) {
            this.applyInheritedState(inheritState);
        }

        this.initComponents();
    }

    /**
     * 应用继承的番茄钟状态
     */
    private applyInheritedState(inheritState: any) {
        console.log('开始应用继承状态:', inheritState);

        // 继承基本状态
        this.isWorkPhase = inheritState.isWorkPhase;
        this.isLongBreak = inheritState.isLongBreak;
        this.completedPomodoros = inheritState.completedPomodoros || 0;

        // 根据计时模式应用不同的时间状态
        if (this.isCountUp) {
            // 正计时模式
            if (inheritState.isWorkPhase) {
                this.timeElapsed = inheritState.timeElapsed || 0;
                this.breakTimeLeft = 0;
            } else {
                // 休息阶段：继承剩余休息时间和已用工作时间
                this.timeElapsed = inheritState.timeElapsed || 0;
                this.breakTimeLeft = inheritState.breakTimeLeft || (this.isLongBreak ?
                    this.settings.longBreakDuration * 60 : this.settings.breakDuration * 60);
            }
        } else {
            // 倒计时模式
            this.timeLeft = inheritState.timeLeft || this.settings.workDuration * 60;
            this.timeElapsed = inheritState.timeElapsed || 0;
            this.breakTimeLeft = inheritState.breakTimeLeft || 0;

            // 重新计算totalTime
            if (this.isWorkPhase) {
                this.totalTime = this.settings.workDuration * 60;
            } else if (this.isLongBreak) {
                this.totalTime = this.settings.longBreakDuration * 60;
            } else {
                this.totalTime = this.settings.breakDuration * 60;
            }
        }

        // 继承运行状态，但新番茄钟开始时不暂停
        this.isRunning = inheritState.isRunning && !inheritState.isPaused;
        this.isPaused = false;

        // 重置时间追踪变量
        this.pausedTime = 0;
        this.startTime = 0;

        // 设置当前阶段的原始时长
        if (this.isWorkPhase) {
            this.currentPhaseOriginalDuration = this.settings.workDuration;
        } else if (this.isLongBreak) {
            this.currentPhaseOriginalDuration = this.settings.longBreakDuration;
        } else {
            this.currentPhaseOriginalDuration = this.settings.breakDuration;
        }

        console.log('继承状态应用完成:', {
            isWorkPhase: this.isWorkPhase,
            isLongBreak: this.isLongBreak,
            timeElapsed: this.timeElapsed,
            timeLeft: this.timeLeft,
            breakTimeLeft: this.breakTimeLeft,
            completedPomodoros: this.completedPomodoros,
            isRunning: this.isRunning,
            currentPhaseOriginalDuration: this.currentPhaseOriginalDuration
        });
    }

    /**
     * 获取当前番茄钟状态，用于状态继承
     */
    /**
     * 获取当前番茄钟状态，用于状态继承
     */
    public getCurrentState() {
        // 如果正在运行，计算实时状态
        let currentTimeElapsed = this.timeElapsed;
        let currentTimeLeft = this.timeLeft;
        let currentBreakTimeLeft = this.breakTimeLeft;

        if (this.isRunning && !this.isPaused && this.startTime > 0) {
            const currentTime = Date.now();
            const realElapsedTime = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                if (this.isWorkPhase) {
                    currentTimeElapsed = realElapsedTime;
                } else {
                    const totalBreakTime = this.isLongBreak ?
                        this.settings.longBreakDuration * 60 :
                        this.settings.breakDuration * 60;
                    currentBreakTimeLeft = totalBreakTime - realElapsedTime;
                }
            } else {
                currentTimeLeft = this.totalTime - realElapsedTime;
                currentTimeElapsed = realElapsedTime;
            }
        }

        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            isWorkPhase: this.isWorkPhase,
            isLongBreak: this.isLongBreak,
            isCountUp: this.isCountUp,
            timeElapsed: currentTimeElapsed,
            timeLeft: Math.max(0, currentTimeLeft),
            breakTimeLeft: Math.max(0, currentBreakTimeLeft),
            totalTime: this.totalTime,
            completedPomodoros: this.completedPomodoros,
            reminderTitle: this.reminder.title,
            reminderId: this.reminder.id,
            currentPhaseOriginalDuration: this.currentPhaseOriginalDuration
        };
    }

    private async initComponents() {
        await this.recordManager.initialize();
        this.initAudio();
        this.createWindow();
        this.updateStatsDisplay();
    }

    private initAudio() {
        // 初始化工作背景音
        if (this.settings.workSound) {
            try {
                this.workAudio = new Audio(this.settings.workSound);
                this.workAudio.loop = true;
                this.workAudio.volume = this.isBackgroundAudioMuted ? 0 : this.backgroundVolume;
                this.workAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载工作背景音:', error);
            }
        }

        // 初始化短时休息背景音
        if (this.settings.breakSound) {
            try {
                this.breakAudio = new Audio(this.settings.breakSound);
                this.breakAudio.loop = true;
                this.breakAudio.volume = this.isBackgroundAudioMuted ? 0 : this.backgroundVolume;
                this.breakAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载短时休息背景音:', error);
            }
        }

        // 初始化长时休息背景音
        if (this.settings.longBreakSound) {
            try {
                this.longBreakAudio = new Audio(this.settings.longBreakSound);
                this.longBreakAudio.loop = true;
                this.longBreakAudio.volume = this.isBackgroundAudioMuted ? 0 : this.backgroundVolume;
                this.longBreakAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载长时休息背景音:', error);
            }
        }

        // 初始化工作结束提示音（音量不受静音影响）
        if (this.settings.workEndSound) {
            try {
                this.workEndAudio = new Audio(this.settings.workEndSound);
                this.workEndAudio.volume = 1;
                this.workEndAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载工作结束提示音:', error);
            }
        }

        // 初始化休息结束提示音（音量不受静音影响）
        if (this.settings.breakEndSound) {
            try {
                this.breakEndAudio = new Audio(this.settings.breakEndSound);
                this.breakEndAudio.volume = 1;
                this.breakEndAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载休息结束提示音:', error);
            }
        }

        // 初始化随机提示音
        if (this.randomNotificationEnabled && this.settings.randomNotificationSounds) {
            this.initRandomNotificationSounds();
        }

        // 初始化随机提示音结束声音
        if (this.randomNotificationEnabled && this.settings.randomNotificationEndSound) {
            this.initRandomNotificationEndSound();
        }
    }

    private attachAudioUnlockListeners() {
        if (this.audioInitialized || this.audioUnlockHandler) {
            return;
        }

        const handler = () => {
            this.detachAudioUnlockListeners();
            this.initializeAudioPlayback();
        };

        this.audioUnlockHandler = handler;

        ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
            document.addEventListener(eventName, handler, { capture: true });
        });
    }

    private detachAudioUnlockListeners() {
        if (!this.audioUnlockHandler) {
            return;
        }

        ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
            document.removeEventListener(eventName, this.audioUnlockHandler!);
        });

        this.audioUnlockHandler = null;
    }

    private initRandomNotificationSounds() {
        try {
            const soundPaths = this.settings.randomNotificationSounds
                .split(',')
                .map(path => path.trim())
                .filter(path => path.length > 0);

            this.randomNotificationSounds = [];
            soundPaths.forEach((path, index) => {
                try {
                    const audio = new Audio(path);
                    audio.volume = 1; // 随机提示音固定音量，不受背景音静音影响
                    audio.preload = 'auto';


                    // 监听加载事件
                    audio.addEventListener('canplaythrough', () => {
                        console.log(`随机提示音 ${index + 1} 加载完成: ${path}`);
                    });


                    audio.addEventListener('error', (e) => {
                        console.error(`随机提示音 ${index + 1} 加载失败: ${path}`, e);
                    });


                    this.randomNotificationSounds.push(audio);
                } catch (error) {
                    console.warn(`无法创建随机提示音 ${index + 1}: ${path}`, error);
                }
            });

            console.log(`已初始化 ${this.randomNotificationSounds.length} 个随机提示音文件`);
        } catch (error) {
            console.warn('初始化随机提示音失败:', error);
        }
    }

    private initRandomNotificationEndSound() {
        try {
            if (this.settings.randomNotificationEndSound) {
                this.randomNotificationEndSound = new Audio(this.settings.randomNotificationEndSound);
                this.randomNotificationEndSound.volume = 1; // 固定音量，不受背景音静音影响
                this.randomNotificationEndSound.preload = 'auto';


                // 监听加载事件
                this.randomNotificationEndSound.addEventListener('canplaythrough', () => {
                    console.log('随机提示音结束声音加载完成');
                });


                this.randomNotificationEndSound.addEventListener('error', (e) => {
                    console.error('随机提示音结束声音加载失败:', e);
                });


                console.log('已初始化随机提示音结束声音');
            }
        } catch (error) {
            console.warn('无法创建随机提示音结束声音:', error);
        }
    }

    private async playRandomNotificationSound() {
        if (!this.randomNotificationEnabled || this.randomNotificationSounds.length === 0) {
            console.warn('随机提示音未启用或无可用音频文件');
            return;
        }

        try {
            if (!this.audioInitialized) {
                console.log('音频未初始化，开始初始化...');
                await this.initializeAudioPlayback();
            }

            // 随机选择一个提示音
            const randomIndex = Math.floor(Math.random() * this.randomNotificationSounds.length);
            const selectedAudio = this.randomNotificationSounds[randomIndex];


            console.log(`准备播放随机提示音 ${randomIndex + 1}/${this.randomNotificationSounds.length}`);

            // 等待音频加载完成
            if (selectedAudio.readyState < 3) {
                console.log('音频未完全加载，等待加载...');
                await this.waitForAudioLoad(selectedAudio);
            }

            // 确保音量设置正确（不受背景音静音影响）
            selectedAudio.volume = 1;

            let notificationPlayed = await this.playOneShotAudio(selectedAudio);

            if (!notificationPlayed) {
                console.warn('一次性播放随机提示音失败，尝试直接播放原音频元素');
                try {
                    selectedAudio.currentTime = 0;
                    await this.safePlayAudio(selectedAudio);
                    notificationPlayed = true;
                } catch (fallbackError) {
                    console.warn('随机提示音回退播放仍然失败:', fallbackError);
                }
            }

            if (notificationPlayed) {
                console.log('随机提示音播放成功');
            }

            // 显示系统通知
            if (this.randomNotificationSystemNotificationEnabled) {
                this.showSystemNotification(
                    t('randomNotificationSettings'),
                    t('randomRest', { duration: this.settings.randomNotificationBreakDuration })
                );
            }

            // 使用设置中的微休息时间播放结束声音
            if (this.randomNotificationEndSound) {
                const breakDurationSeconds = Number(this.settings.randomNotificationBreakDuration) || 0;
                const breakDuration = Math.max(0, breakDurationSeconds * 1000);

                window.setTimeout(async () => {
                    try {
                        let endPlayed = await this.playOneShotAudio(this.randomNotificationEndSound);

                        if (!endPlayed) {
                            console.warn('一次性播放随机提示音结束声音失败，尝试回退播放');
                            try {
                                this.randomNotificationEndSound.currentTime = 0;
                                await this.safePlayAudio(this.randomNotificationEndSound);
                                endPlayed = true;
                            } catch (endFallbackError) {
                                console.warn('随机提示音结束声音回退仍然失败:', endFallbackError);
                            }
                        }

                        if (endPlayed) {
                            console.log('随机提示音结束声音播放成功');
                        }
                    } catch (error) {
                        console.warn('播放随机提示音结束声音失败:', error);
                    } finally {
                        if (this.randomNotificationSystemNotificationEnabled) {
                            this.showSystemNotification(
                                t('randomNotificationSettings'),
                                t('randomRestComplete') || '微休息时间结束，可以继续专注工作了！'
                            );
                        }
                    }
                }, breakDuration);
            } else if (this.randomNotificationSystemNotificationEnabled) {
                const breakDurationSeconds = Number(this.settings.randomNotificationBreakDuration) || 0;
                const breakDuration = Math.max(0, breakDurationSeconds * 1000);

                window.setTimeout(() => {
                    this.showSystemNotification(
                        t('randomNotificationSettings'),
                        t('randomRestComplete') || '微休息时间结束，可以继续专注工作了！'
                    );
                }, breakDuration);
            }

        } catch (error) {
            console.error('播放随机提示音失败:', error);
        }
    }

    private startRandomNotificationTimer() {
        if (!this.randomNotificationEnabled || !this.isWorkPhase) {
            return;
        }

        this.stopRandomNotificationTimer();

        // 使用设置中的时间间隔范围
        const minInterval = this.settings.randomNotificationMinInterval * 60 * 1000; // 转换为毫秒
        const maxInterval = this.settings.randomNotificationMaxInterval * 60 * 1000; // 转换为毫秒

        // 确保最大间隔大于等于最小间隔
        const actualMaxInterval = Math.max(minInterval, maxInterval);
        const randomInterval = minInterval + Math.random() * (actualMaxInterval - minInterval);

        this.randomNotificationTimer = window.setTimeout(() => {
            this.playRandomNotificationSound();
            // 递归调用，设置下一次随机提示音
            this.startRandomNotificationTimer();
        }, randomInterval);

        console.log(`随机提示音将在 ${Math.round(randomInterval / 60000)} 分钟后播放`);
    }

    private stopRandomNotificationTimer() {
        if (this.randomNotificationTimer) {
            clearTimeout(this.randomNotificationTimer);
            this.randomNotificationTimer = null;
        }
    }

    private async initializeAudioPlayback(force: boolean = false) {
        if (this.audioInitialized && !force) {
            return;
        }

        if (this.audioInitPromise && !force) {
            try {
                await this.audioInitPromise;
            } catch {
                // 已有的初始化失败被忽略，等待后续用户手势重试
            }
            return;
        }

        this.audioInitPromise = (async () => {
            try {
                // 创建一个静默音频来获取播放权限
                const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
                silentAudio.volume = 0;
                await silentAudio.play();
                silentAudio.pause();

                const audioLoadPromises: Array<Promise<void>> = [];

                if (this.workAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.workAudio));
                }
                if (this.breakAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.breakAudio));
                }
                if (this.longBreakAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.longBreakAudio));
                }
                if (this.workEndAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.workEndAudio));
                }
                if (this.breakEndAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.breakEndAudio));
                }

                if (this.randomNotificationSounds.length > 0) {
                    this.randomNotificationSounds.forEach((audio) => {
                        audioLoadPromises.push(this.waitForAudioLoad(audio));
                    });
                }

                if (this.randomNotificationEndSound) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.randomNotificationEndSound));
                }

                await Promise.allSettled(audioLoadPromises);

                this.audioInitialized = true;
                this.detachAudioUnlockListeners();
                console.log('音频播放权限已获取，所有音频文件已加载');
            } catch (error) {
                this.audioInitialized = false;
                console.warn('无法获取音频播放权限:', error);
                this.attachAudioUnlockListeners();
                throw error;
            } finally {
                this.audioInitPromise = null;
            }
        })();

        try {
            await this.audioInitPromise;
        } catch {
            // 忽略异常，等待下一次用户交互重新尝试
        }
    }

    /**
     * 等待音频文件加载完成
     */
    private waitForAudioLoad(audio: HTMLAudioElement): Promise<void> {
        return new Promise((resolve, reject) => {
            if (audio.readyState >= 3) { // HAVE_FUTURE_DATA
                resolve();
                return;
            }

            const onLoad = () => {
                cleanup();
                resolve();
            };

            const onError = () => {
                cleanup();
                reject(new Error('音频加载失败'));
            };

            const onTimeout = () => {
                cleanup();
                console.warn('音频加载超时，但继续执行');
                resolve(); // 超时时也resolve，避免阻塞
            };

            const cleanup = () => {
                audio.removeEventListener('canplaythrough', onLoad);
                audio.removeEventListener('error', onError);
                clearTimeout(timeoutId);
            };

            audio.addEventListener('canplaythrough', onLoad);
            audio.addEventListener('error', onError);

            // 设置5秒超时
            const timeoutId = setTimeout(onTimeout, 5000);

            // 触发加载
            audio.load();
        });
    }

    private async playOneShotAudio(audio: HTMLAudioElement | null): Promise<boolean> {
        if (!audio) {
            return false;
        }

        try {
            await this.initializeAudioPlayback();

            if (audio.readyState < 2) {
                await this.waitForAudioLoad(audio);
            }

            const source = audio.currentSrc || audio.src;
            if (!source) {
                return false;
            }

            const playbackAudio = new Audio(source);
            playbackAudio.preload = 'auto';
            playbackAudio.volume = audio.volume;
            playbackAudio.muted = audio.muted;
            playbackAudio.playbackRate = audio.playbackRate;
            playbackAudio.crossOrigin = audio.crossOrigin || playbackAudio.crossOrigin;
            playbackAudio.setAttribute('playsinline', 'true');
            playbackAudio.currentTime = 0;

            const cleanup = () => {
                playbackAudio.pause();
                playbackAudio.src = '';
            };

            playbackAudio.addEventListener('ended', cleanup, { once: true });
            playbackAudio.addEventListener('error', cleanup, { once: true });

            const playPromise = playbackAudio.play();
            if (playPromise) {
                await playPromise;
            }

            const started = await this.waitForPlaybackStart(playbackAudio);
            if (!started) {
                cleanup();
                return false;
            }

            const durationMs = (playbackAudio.duration > 0 && isFinite(playbackAudio.duration))
                ? playbackAudio.duration * 1000 + 500
                : 5000;

            window.setTimeout(() => cleanup(), durationMs);

            return true;
        } catch (error) {
            console.warn('一次性音频播放失败:', error);
            this.attachAudioUnlockListeners();
            return false;
        }
    }

    private waitForPlaybackStart(audio: HTMLAudioElement): Promise<boolean> {
        return new Promise((resolve) => {
            if (!audio.paused && audio.currentTime > 0) {
                resolve(true);
                return;
            }

            const cleanup = () => {
                audio.removeEventListener('playing', onPlaying);
                audio.removeEventListener('timeupdate', onTimeUpdate);
                audio.removeEventListener('ended', onEnded);
                audio.removeEventListener('error', onError);
                clearTimeout(timeoutId);
            };

            const onPlaying = () => {
                cleanup();
                resolve(true);
            };

            const onTimeUpdate = () => {
                if (audio.currentTime > 0) {
                    cleanup();
                    resolve(true);
                }
            };

            const onEnded = () => {
                cleanup();
                resolve(audio.currentTime > 0);
            };

            const onError = () => {
                cleanup();
                resolve(false);
            };

            audio.addEventListener('playing', onPlaying);
            audio.addEventListener('timeupdate', onTimeUpdate);
            audio.addEventListener('ended', onEnded);
            audio.addEventListener('error', onError);

            const timeoutId = window.setTimeout(() => {
                cleanup();
                resolve(!audio.paused && audio.currentTime > 0);
            }, 1000);
        });
    }

    private async safePlayAudio(audio: HTMLAudioElement) {
        if (!audio) return;

        try {
            // 确保音频已初始化
            if (!this.audioInitialized) {
                await this.initializeAudioPlayback();
            }

            // 检查音频是否准备就绪
            if (audio.readyState < 3) {
                console.log('音频未就绪，等待加载完成...');
                await this.waitForAudioLoad(audio);
            }

            // 重置音频到开始位置
            audio.currentTime = 0;

            // 播放音频
            await audio.play();
            console.log('音频播放成功');
        } catch (error) {
            console.warn('音频播放失败:', error);

            if (error.name === 'NotAllowedError') {
                console.log('尝试重新获取音频播放权限...');
                this.audioInitialized = false;
                // 尝试重新初始化
                try {
                    await this.initializeAudioPlayback();
                    if (audio.readyState >= 3) {
                        audio.currentTime = 0;
                        await audio.play();
                    }
                } catch (retryError) {
                    console.warn('重试音频播放失败:', retryError);
                }
            } else if (error.name === 'AbortError') {
                console.log('播放被中断，尝试延迟重试...');
                // 延迟一小段时间后重试
                setTimeout(async () => {
                    try {
                        if (audio.readyState >= 3) {
                            audio.currentTime = 0;
                            await audio.play();
                        }
                    } catch (delayedError) {
                        console.warn('延迟重试也失败:', delayedError);
                    }
                }, 100);
            }
        }
    }

    private createWindow() {
        // 创建悬浮窗口容器
        this.container = document.createElement('div');
        this.container.className = 'pomodoro-timer-window';
        this.container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 240px;
            background: var(--b3-theme-background);
            border: 1px solid var(--b3-table-border-color);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
            z-index: 10000;
            user-select: none;
            backdrop-filter: blur(16px);
            transition: transform 0.2s ease, opacity 0.2s ease;
            overflow: hidden;
        `;

        // 创建最小化视图
        this.createMinimizedView();

        // 标题栏
        const header = document.createElement('div');
        header.className = 'pomodoro-header';
        header.style.cssText = `
            padding: 6px;
            background: var(--b3-theme-surface);
            border-radius: 12px 12px 0 0;
            border-bottom: 1px solid var(--b3-table-border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
        `;

        const title = document.createElement('div');
        title.className = 'pomodoro-title';
        title.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        // 最小化按钮（替换原来的🍅图标）
        this.minimizeBtn = document.createElement('button');
        this.minimizeBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 16px;
            line-height: 1;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        this.minimizeBtn.innerHTML = '🍅';
        this.minimizeBtn.title = t('minimize') || '最小化'; // i18n
        this.minimizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleMinimize();
        });

        const titleText = document.createElement('span');
        title.appendChild(this.minimizeBtn);
        title.appendChild(titleText);

        const headerButtons = document.createElement('div');
        headerButtons.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        // 计时模式切换按钮
        this.modeToggleBtn = document.createElement('button');
        this.modeToggleBtn.className = 'pomodoro-mode-toggle';
        this.modeToggleBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        this.modeToggleBtn.innerHTML = this.isCountUp ? '⏱️' : '⏳';
        this.modeToggleBtn.title = this.isCountUp ? t('switchToCountdown') || '切换到倒计时' : t('switchToCountUp') || '切换到正计时';
        this.modeToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleMode();
        });

        // 工作时间按钮
        const workBtn = document.createElement('button');
        workBtn.className = 'pomodoro-work-btn';
        workBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        workBtn.innerHTML = '💪';
        workBtn.title = t('pomodoroWork') || '工作时间';
        workBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startWorkTime();
        });

        // 短时休息按钮
        const shortBreakBtn = document.createElement('button');
        shortBreakBtn.className = 'pomodoro-break-btn';
        shortBreakBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        shortBreakBtn.innerHTML = '🍵';
        shortBreakBtn.title = t('pomodoroBreak') || '短时休息';
        shortBreakBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startShortBreak();
        });

        // 长时休息按钮
        const longBreakBtn = document.createElement('button');
        longBreakBtn.className = 'pomodoro-break-btn';
        longBreakBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        longBreakBtn.innerHTML = '🧘';
        longBreakBtn.title = t('pomodoroLongBreak') || '长时休息';
        longBreakBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startLongBreak();
        });

        // 展开/折叠按钮
        this.expandToggleBtn = document.createElement('button');
        this.expandToggleBtn.className = 'pomodoro-expand-toggle';
        this.expandToggleBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        this.expandToggleBtn.innerHTML = this.isExpanded ? '📉' : '📈';
        this.expandToggleBtn.title = this.isExpanded ? t('collapse') || '折叠' : t('expand') || '展开';
        this.expandToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleExpand();
        });

        // 全屏模式切换按钮
        this.fullscreenBtn = document.createElement('button');
        this.fullscreenBtn.className = 'pomodoro-fullscreen-btn';
        this.fullscreenBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        this.fullscreenBtn.innerHTML = '🔳';
        this.fullscreenBtn.title = t('fullscreenMode') || '全屏模式';
        this.fullscreenBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleFullscreen();
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'pomodoro-close';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 16px;
            line-height: 1;
            opacity: 0.7;
            transition: opacity 0.2s;
        `;
        closeBtn.innerHTML = '×';
        closeBtn.title = t('close') || '关闭';
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.close();
        });

        headerButtons.appendChild(this.modeToggleBtn);
        headerButtons.appendChild(workBtn);
        headerButtons.appendChild(shortBreakBtn);
        headerButtons.appendChild(longBreakBtn);
        headerButtons.appendChild(this.expandToggleBtn);
        headerButtons.appendChild(this.fullscreenBtn); // 添加全屏按钮
        headerButtons.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(headerButtons);

        // 主体内容
        const content = document.createElement('div');
        content.className = 'pomodoro-content';
        content.style.cssText = `
            padding: 0px 16px 6px;
        `;

        // 事件名称显示
        const eventTitle = document.createElement('div');
        eventTitle.className = 'pomodoro-event-title';
        eventTitle.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
            text-align: center;
            border-radius: 6px;
            border: 1px solid var(--b3-theme-border);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 5px;
            cursor: pointer;
            transition: all 0.2s ease;
            padding: 4px 8px;
            font-family: var(--b3-font-family) !important;
        `;
        eventTitle.textContent = this.reminder.title || t("unnamedNote");
        eventTitle.title = t("openNote") + ': ' + (this.reminder.title || t("unnamedNote"));

        // 添加悬停效果
        eventTitle.addEventListener('mouseenter', () => {
            eventTitle.style.backgroundColor = 'var(--b3-theme-surface-hover)';
            eventTitle.style.borderColor = 'var(--b3-theme-primary)';
        });
        eventTitle.addEventListener('mouseleave', () => {
            eventTitle.style.backgroundColor = 'transparent';
            eventTitle.style.borderColor = 'var(--b3-theme-border)';
        });

        // 添加点击事件
        eventTitle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openRelatedNote();
        });

        // 主要布局容器
        const mainContainer = document.createElement('div');
        mainContainer.className = 'pomodoro-main-container';
        mainContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 10px;
        `;

        // 左侧圆环进度条
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            position: relative;
            width: 80px;
            height: 80px;
            flex-shrink: 0;
        `;

        // 创建 SVG 圆环
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = `
            width: 80px;
            height: 80px;
            transform: rotate(-90deg);
        `;
        svg.setAttribute('viewBox', '0 0 80 80');

        // 背景圆环
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '40');
        bgCircle.setAttribute('cy', '40');
        bgCircle.setAttribute('r', '36');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', '#e0e0e0');
        bgCircle.setAttribute('stroke-width', '6');
        bgCircle.setAttribute('opacity', '0.3');

        // 进度圆环
        this.circularProgress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.circularProgress.setAttribute('cx', '40');
        this.circularProgress.setAttribute('cy', '40');
        this.circularProgress.setAttribute('r', '36');
        this.circularProgress.setAttribute('fill', 'none');
        this.circularProgress.setAttribute('stroke', '#FF6B6B');
        this.circularProgress.setAttribute('stroke-width', '6');
        this.circularProgress.setAttribute('stroke-linecap', 'round');

        const circumference = 2 * Math.PI * 36;
        this.circularProgress.style.cssText = `
            stroke-dasharray: ${circumference};
            stroke-dashoffset: ${circumference};
            transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
        `;

        svg.appendChild(bgCircle);
        svg.appendChild(this.circularProgress);

        // 圆环中心的控制按钮容器
        const centerContainer = document.createElement('div');
        centerContainer.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            display: flex;
            align-items: center;
            justify-content: center;
            width: 60px;
            height: 60px;
        `;

        // 状态图标
        const statusIcon = document.createElement('div');
        statusIcon.className = 'pomodoro-status-icon';
        statusIcon.style.cssText = `
            font-size: 28px;
            line-height: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            position: absolute;
            top: 0;
            left: 0;
            transition: opacity 0.2s ease;
        `;
        statusIcon.innerHTML = '🍅';

        this.startPauseBtn = document.createElement('button');
        this.startPauseBtn.className = 'circle-control-btn';
        this.startPauseBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.9);
            border: none;
            cursor: pointer;
            font-size: 18px;
            color: var(--b3-theme-on-surface);
            padding: 0;
            border-radius: 50%;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 0;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(4px);
        `;
        this.startPauseBtn.innerHTML = '▶️';
        this.startPauseBtn.addEventListener('click', () => this.toggleTimer());

        this.stopBtn = document.createElement('button');
        this.stopBtn.className = 'circle-control-btn';
        this.stopBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.9);
            border: none;
            cursor: pointer;
            font-size: 14px;
            color: var(--b3-theme-on-surface);
            padding: 0;
            border-radius: 50%;
            transition: all 0.2s ease;
            display: none;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) translateX(16px);
            opacity: 0;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(4px);
        `;
        this.stopBtn.innerHTML = '⏹';
        this.stopBtn.addEventListener('click', () => this.resetTimer());

        // 添加悬浮效果
        centerContainer.addEventListener('mouseenter', () => {
            // 状态图标变透明
            statusIcon.style.opacity = '0.3';

            if (!this.isRunning) {
                // 未运行状态：显示开始按钮
                this.startPauseBtn.style.opacity = '1';
                this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
                this.stopBtn.style.opacity = '0';
                this.stopBtn.style.display = 'none';
            } else if (this.isPaused) {
                // 暂停状态：显示继续按钮和停止按钮
                this.startPauseBtn.style.opacity = '1';
                this.stopBtn.style.opacity = '1';
                this.stopBtn.style.display = 'flex';
                this.startPauseBtn.style.transform = 'translate(-50%, -50%) translateX(-12px)';
                this.stopBtn.style.transform = 'translate(-50%, -50%) translateX(12px)';
            } else {
                // 运行状态：显示暂停按钮
                this.startPauseBtn.style.opacity = '1';
                this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
                this.stopBtn.style.opacity = '0';
                this.stopBtn.style.display = 'none';
            }
        });

        centerContainer.addEventListener('mouseleave', () => {
            // 状态图标恢复
            statusIcon.style.opacity = '1';

            // 隐藏所有按钮并重置位置
            this.startPauseBtn.style.opacity = '0';
            this.stopBtn.style.opacity = '0';
            this.stopBtn.style.display = 'none';
            this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
            this.stopBtn.style.transform = 'translate(-50%, -50%) translateX(16px)';
        });

        centerContainer.appendChild(statusIcon);
        centerContainer.appendChild(this.startPauseBtn);
        centerContainer.appendChild(this.stopBtn);

        progressContainer.appendChild(svg);
        progressContainer.appendChild(centerContainer);

        // 右侧时间和状态信息
        const timeInfo = document.createElement('div');
        timeInfo.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        this.statusDisplay = document.createElement('div');
        this.statusDisplay.className = 'pomodoro-status';
        this.statusDisplay.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface-variant);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        `;
        this.statusDisplay.textContent = t('pomodoroWork') || '工作时间';

        this.timeDisplay = document.createElement('div');
        this.timeDisplay.className = 'pomodoro-time';
        this.timeDisplay.style.cssText = `
            font-size: 24px;
            font-weight: 700;
            color: var(--b3-theme-on-surface);
            font-variant-numeric: tabular-nums;
            line-height: 1.2;
            cursor: pointer;
            user-select: none;
            border-radius: 4px;
            padding: 2px 4px;
            transition: background-color 0.2s;
        `;
        this.timeDisplay.title = t('editTime') || '双击编辑时间';

        // 添加双击事件监听器
        this.timeDisplay.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.editTime();
        });

        // 添加悬停效果
        this.timeDisplay.addEventListener('mouseenter', () => {
            this.timeDisplay.style.backgroundColor = 'var(--b3-theme-surface-hover)';
        });
        this.timeDisplay.addEventListener('mouseleave', () => {
            this.timeDisplay.style.backgroundColor = 'transparent';
        });

        // 番茄数量显示（正计时模式下显示）
        const pomodoroCountContainer = document.createElement('div');
        pomodoroCountContainer.className = 'pomodoro-count';
        pomodoroCountContainer.style.cssText = `
            font-size: 14px;
            color: var(--b3-theme-on-surface-variant);
            display: flex;
            align-items: center;
            gap: 4px;
            justify-content: space-between;
            width: 100%;
        `;

        // 番茄数量左侧部分
        const pomodoroCountLeft = document.createElement('div');
        pomodoroCountLeft.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;
        pomodoroCountLeft.innerHTML = `🍅 <span id="pomodoroCount">${this.completedPomodoros}</span>`;

        // 音量控制容器（右侧）
        const volumeControlContainer = document.createElement('div');
        volumeControlContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            position: relative;
        `;

        // 创建声音控制按钮
        this.soundControlBtn = document.createElement('button');
        this.soundControlBtn.className = 'pomodoro-sound-control';
        this.soundControlBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface-variant);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        `;
        this.soundControlBtn.innerHTML = this.isBackgroundAudioMuted ? '🔇' : '🔊';
        this.soundControlBtn.title = this.isBackgroundAudioMuted ? t('enableBackgroundAudio') || '开启背景音' : t('muteBackgroundAudio') || '静音背景音';

        // 创建音量控制容器
        this.createVolumeControl();

        // 将音量容器添加到声音按钮的父容器中
        volumeControlContainer.appendChild(this.soundControlBtn);
        volumeControlContainer.appendChild(this.volumeContainer);

        // 组装番茄数量容器
        pomodoroCountContainer.appendChild(pomodoroCountLeft);
        pomodoroCountContainer.appendChild(volumeControlContainer);

        // 添加声音控制按钮事件
        this.soundControlBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleBackgroundAudio();
        });

        // 添加音量控制悬浮事件
        this.addVolumeControlEvents(volumeControlContainer);

        timeInfo.appendChild(this.statusDisplay);
        timeInfo.appendChild(this.timeDisplay);
        timeInfo.appendChild(pomodoroCountContainer);

        mainContainer.appendChild(progressContainer);
        mainContainer.appendChild(timeInfo);

        // 统计信息容器
        this.statsContainer = document.createElement('div');
        this.statsContainer.className = 'pomodoro-stats';
        this.statsContainer.style.cssText = `
            display: ${this.isExpanded ? 'flex' : 'none'};
            justify-content: space-between;
            padding: 12px;
            background: var(--b3-theme-surface);
            border-radius: 8px;
            transition: all 0.3s ease;
        `;

        const todayStats = document.createElement('div');
        todayStats.style.cssText = `
            flex: 1;
            text-align: center;
            padding: 0 8px;
        `;

        const todayLabel = document.createElement('div');
        todayLabel.style.cssText = `
            font-size: 11px;
            color: var(--b3-theme-on-surface-variant);
            margin-bottom: 4px;
        `;
        todayLabel.textContent = t('todayFocus') || '今日专注';

        this.todayFocusDisplay = document.createElement('div');
        this.todayFocusDisplay.style.cssText = `
            font-size: 16px;
            font-weight: 600;
            color: #FF6B6B;
        `;

        todayStats.appendChild(todayLabel);
        todayStats.appendChild(this.todayFocusDisplay);

        const weekStats = document.createElement('div');
        weekStats.style.cssText = `
            flex: 1;
            text-align: center;
            padding: 0 8px;
            border-left: 1px solid var(--b3-theme-border);
        `;

        const weekLabel = document.createElement('div');
        weekLabel.style.cssText = `
            font-size: 11px;
            color: var(--b3-theme-on-surface-variant);
            margin-bottom: 4px;
        `;
        weekLabel.textContent = t('weekFocus') || '本周专注';

        this.weekFocusDisplay = document.createElement('div');
        this.weekFocusDisplay.style.cssText = `
            font-size: 16px;
            font-weight: 600;
            color: #4CAF50;
        `;

        weekStats.appendChild(weekLabel);
        weekStats.appendChild(this.weekFocusDisplay);

        this.statsContainer.appendChild(todayStats);
        this.statsContainer.appendChild(weekStats);

        content.appendChild(eventTitle);
        content.appendChild(mainContainer);
        content.appendChild(this.statsContainer);

        this.container.appendChild(this.minimizedView);
        this.container.appendChild(header);
        this.container.appendChild(content);

        // 添加拖拽功能
        this.makeDraggable(header);

        // 更新显示
        this.updateDisplay();

        document.body.appendChild(this.container);
    }

    private createVolumeControl() {
        // 创建音量控制容器
        this.volumeContainer = document.createElement('div');
        this.volumeContainer.className = 'pomodoro-volume-container';
        this.volumeContainer.style.cssText = `
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 20px;
            padding: 8px 12px;
            display: none;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(8px);
            z-index: 1000;
            white-space: nowrap;
            min-width: 120px;
        `;

        // 音量图标
        const volumeIcon = document.createElement('span');
        volumeIcon.style.cssText = `
            font-size: 14px;
            opacity: 0.7;
        `;
        volumeIcon.textContent = '🔊';

        // 音量滑块
        this.volumeSlider = document.createElement('input');
        this.volumeSlider.type = 'range';
        this.volumeSlider.min = '0';
        this.volumeSlider.max = '1';
        this.volumeSlider.step = '0.1';
        this.volumeSlider.value = this.backgroundVolume.toString();
        this.volumeSlider.style.cssText = `
            flex: 1;
            height: 4px;
            background: var(--b3-theme-surface-lighter);
            border-radius: 2px;
            outline: none;
            cursor: pointer;
            -webkit-appearance: none;
            appearance: none;
        `;

        // 滑块样式
        const style = document.createElement('style');
        style.textContent = `
            .pomodoro-volume-container input[type="range"]::-webkit-slider-thumb {
                appearance: none;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: var(--b3-theme-primary);
                cursor: pointer;
                border: none;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
            }
            .pomodoro-volume-container input[type="range"]::-moz-range-thumb {
                appearance: none;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: var(--b3-theme-primary);
                cursor: pointer;
                border: none;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
            }
        `;
        document.head.appendChild(style);

        // 音量百分比显示
        const volumePercent = document.createElement('span');
        volumePercent.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface-variant);
            min-width: 30px;
            text-align: right;
        `;
        volumePercent.textContent = Math.round(this.backgroundVolume * 100) + '%';

        // 滑块事件
        this.volumeSlider.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            this.backgroundVolume = volume;
            volumePercent.textContent = Math.round(volume * 100) + '%';
            this.updateAudioVolume();
        });

        this.volumeContainer.appendChild(volumeIcon);
        this.volumeContainer.appendChild(this.volumeSlider);
        this.volumeContainer.appendChild(volumePercent);
    }

    private addVolumeControlEvents(container: HTMLElement) {
        let hoverTimer: number = null;

        // 鼠标进入事件
        container.addEventListener('mouseenter', () => {
            // 清除可能存在的隐藏定时器
            if (hoverTimer) {
                clearTimeout(hoverTimer);
                hoverTimer = null;
            }

            // 只有在非静音状态下才显示音量控制
            if (!this.isBackgroundAudioMuted) {
                this.volumeContainer.style.display = 'flex';
                // 添加动画效果
                this.volumeContainer.style.opacity = '0';
                this.volumeContainer.style.transform = 'translateY(-50%) scale(0.9)';

                requestAnimationFrame(() => {
                    this.volumeContainer.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                    this.volumeContainer.style.opacity = '1';
                    this.volumeContainer.style.transform = 'translateY(-50%) scale(1)';
                });
            }
        });

        // 鼠标离开事件
        container.addEventListener('mouseleave', () => {
            // 延迟隐藏，给用户时间移动到音量控制上
            hoverTimer = window.setTimeout(() => {
                this.volumeContainer.style.opacity = '0';
                this.volumeContainer.style.transform = 'translateY(-50%) scale(0.9)';

                setTimeout(() => {
                    this.volumeContainer.style.display = 'none';
                    this.volumeContainer.style.transition = 'none';
                }, 200);
            }, 300);
        });

        // 音量容器本身的悬浮事件，防止鼠标移动到音量控制上时隐藏
        this.volumeContainer.addEventListener('mouseenter', () => {
            if (hoverTimer) {
                clearTimeout(hoverTimer);
                hoverTimer = null;
            }
        });

        this.volumeContainer.addEventListener('mouseleave', () => {
            hoverTimer = window.setTimeout(() => {
                this.volumeContainer.style.opacity = '0';
                this.volumeContainer.style.transform = 'translateY(-50%) scale(0.9)';

                setTimeout(() => {
                    this.volumeContainer.style.display = 'none';
                    this.volumeContainer.style.transition = 'none';
                }, 200);
            }, 100);
        });
    }

    private toggleBackgroundAudio() {
        this.isBackgroundAudioMuted = !this.isBackgroundAudioMuted;

        // 更新按钮显示
        this.soundControlBtn.innerHTML = this.isBackgroundAudioMuted ? '🔇' : '🔊';
        this.soundControlBtn.title = this.isBackgroundAudioMuted ? t('enableBackgroundAudio') || '开启背景音' : t('muteBackgroundAudio') || '静音背景音';

        // 更新音频音量
        this.updateAudioVolume();

        // 如果取消静音，确保音量控制事件正常工作
        if (!this.isBackgroundAudioMuted) {
            // 重新更新音量滑块显示
            const volumePercent = this.volumeContainer.querySelector('span:last-child');
            if (volumePercent) {
                volumePercent.textContent = Math.round(this.backgroundVolume * 100) + '%';
            }
            if (this.volumeSlider) {
                this.volumeSlider.value = this.backgroundVolume.toString();
            }
        }

        // 立即隐藏音量控制（如果是静音）
        if (this.isBackgroundAudioMuted && this.volumeContainer) {
            this.volumeContainer.style.display = 'none';
        }

        const statusText = this.isBackgroundAudioMuted ? (t('backgroundAudioMuted') || '背景音已静音') : (t('backgroundAudioEnabled') || '背景音已开启');
        showMessage(statusText, 1500);
    }

    private updateAudioVolume() {
        const volume = this.isBackgroundAudioMuted ? 0 : this.backgroundVolume;

        if (this.workAudio) {
            this.workAudio.volume = volume;
        }
        if (this.breakAudio) {
            this.breakAudio.volume = volume;
        }
        if (this.longBreakAudio) {
            this.longBreakAudio.volume = volume;
        }
    }
    private createMinimizedView() {
        this.minimizedView = document.createElement('div');
        this.minimizedView.className = 'pomodoro-minimized-view';
        this.minimizedView.style.display = 'none';

        // 进度背景
        this.minimizedBg = document.createElement('div');
        this.minimizedBg.className = 'pomodoro-minimized-bg';

        // 白色覆盖层
        this.minimizedOverlay = document.createElement('div');
        this.minimizedOverlay.className = 'pomodoro-minimized-overlay';

        // 中心图标
        this.minimizedIcon = document.createElement('div');
        this.minimizedIcon.className = 'pomodoro-minimized-icon';
        this.minimizedIcon.innerHTML = '🍅';

        // 恢复按钮
        this.restoreBtn = document.createElement('button');
        this.restoreBtn.className = 'pomodoro-restore-btn';
        this.restoreBtn.innerHTML = '↗';
        this.restoreBtn.title = '恢复窗口';
        this.restoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.restore();
        });

        this.minimizedView.appendChild(this.minimizedBg);
        this.minimizedView.appendChild(this.minimizedOverlay);
        this.minimizedView.appendChild(this.minimizedIcon);
        this.minimizedView.appendChild(this.restoreBtn);

        // 添加拖拽功能到最小化视图（但排除恢复按钮）
        this.makeDraggable(this.minimizedView);
    }

    private toggleMinimize() {
        if (this.isMinimized) {
            this.restore();
        } else {
            this.minimize();
        }
    }

    private minimize() {
        this.isMinimized = true;

        // 添加最小化动画类
        this.container.classList.add('minimizing');

        setTimeout(() => {
            this.container.classList.remove('minimizing');
            this.container.classList.add('minimized');
            this.updateMinimizedDisplay();
        }, 300);
    }

    private restore() {
        this.isMinimized = false;

        // 添加展开动画类
        this.container.classList.remove('minimized');

        setTimeout(() => {
            // 恢复时不显示统计数据
            // this.isExpanded = false;
            // this.statsContainer.style.display = 'none';
            // this.expandToggleBtn.innerHTML = '📈';
            // this.expandToggleBtn.title = '展开';
            this.updateDisplay();
        }, 300);
    }

    private updateMinimizedDisplay() {
        if (!this.isMinimized) return;

        // 计算进度
        let progress = 0;
        let color = '#FF6B6B'; // 默认工作时间颜色

        if (this.isCountUp) {
            if (this.isWorkPhase) {
                // 正计时工作时间：显示当前番茄的进度
                const pomodoroLength = this.settings.workDuration * 60;
                const currentCycleTime = this.timeElapsed % pomodoroLength;
                progress = currentCycleTime / pomodoroLength;
                color = '#FF6B6B';
            } else {
                // 正计时休息时间：显示休息进度
                const totalBreakTime = this.isLongBreak ?
                    this.settings.longBreakDuration * 60 :
                    this.settings.breakDuration * 60;
                progress = (totalBreakTime - this.breakTimeLeft) / totalBreakTime;
                color = this.isLongBreak ? '#9C27B0' : '#4CAF50';
            }
        } else {
            // 倒计时模式：显示完成进度
            progress = (this.totalTime - this.timeLeft) / this.totalTime;
            if (this.isWorkPhase) {
                color = '#FF6B6B';
            } else {
                color = this.isLongBreak ? '#9C27B0' : '#4CAF50';
            }
        }

        // 确保进度在0-1范围内
        progress = Math.max(0, Math.min(1, progress));

        // 转换为角度（360度 = 100%进度）
        const angle = progress * 360;

        // 更新CSS变量
        this.minimizedBg.style.setProperty('--progress-color', color);
        this.minimizedBg.style.setProperty('--progress-angle', `${angle}deg`);

        // 更新图标
        if (this.isWorkPhase) {
            this.minimizedIcon.innerHTML = '🍅';
        } else {
            this.minimizedIcon.innerHTML = this.isLongBreak ? '🧘' : '🍵';
        }
    }

    private makeDraggable(handle: HTMLElement) {
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;

        handle.addEventListener('mousedown', (e) => {
            // 如果点击的是恢复按钮，不触发拖拽
            if (e.target === this.restoreBtn) {
                return;
            }

            // 如果是最小化视图，允许拖拽
            if (this.isMinimized || !e.target.closest('button')) {
                e.preventDefault();
                isDragging = true;

                const rect = this.container.getBoundingClientRect();
                initialX = e.clientX - rect.left;
                initialY = e.clientY - rect.top;

                this.container.style.transition = 'none';
                this.container.style.pointerEvents = 'none';

                // 最小化状态下保持指针事件
                if (this.isMinimized) {
                    this.container.style.pointerEvents = 'auto';
                    // 确保恢复按钮的事件不被阻止
                    this.restoreBtn.style.pointerEvents = 'auto';
                } else {
                    const buttons = this.container.querySelectorAll('button');
                    buttons.forEach(btn => {
                        btn.style.pointerEvents = 'auto';
                    });
                }

                document.addEventListener('mousemove', drag);
                document.addEventListener('mouseup', stopDrag);
            }
        });

        const drag = (e) => {
            if (!isDragging) return;

            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            const maxX = window.innerWidth - this.container.offsetWidth;
            const maxY = window.innerHeight - this.container.offsetHeight;

            currentX = Math.max(0, Math.min(currentX, maxX));
            currentY = Math.max(0, Math.min(currentY, maxY));

            // 清除原有的定位样式，使用left和top进行拖拽定位
            this.container.style.left = currentX + 'px';
            this.container.style.top = currentY + 'px';
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
        };

        const stopDrag = () => {
            isDragging = false;
            this.container.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
            this.container.style.pointerEvents = 'auto';

            document.removeEventListener('mousemove', drag);
            document.removeEventListener('mouseup', stopDrag);
        };
    }

    private toggleMode() {
        if (this.isRunning) {
            showMessage(t('pleaseStopTimerFirst') || '请先停止当前计时器再切换模式', 2000);
            return;
        }

        this.isCountUp = !this.isCountUp;



        // 更新标题图标

        this.modeToggleBtn.innerHTML = this.isCountUp ? '⏱️' : '⏳';
        this.modeToggleBtn.title = this.isCountUp ? t('switchToCountdown') || '切换到倒计时' : t('switchToCountUp') || '切换到正计时';

        // 重置状态
        this.resetTimer();

        const modeText = this.isCountUp ? (t('countUpMode') || '正计时') : (t('countdownMode') || '倒计时');
        showMessage((t('switchedToMode') || '已切换到') + modeText + (t('mode') || '模式'), 2000);
    }

    private toggleExpand() {
        this.isExpanded = !this.isExpanded;

        if (this.isExpanded) {
            this.statsContainer.style.display = 'flex';
            this.expandToggleBtn.innerHTML = '📉';
            this.expandToggleBtn.title = '折叠';
            this.container.style.height = 'auto';
        } else {
            this.statsContainer.style.display = 'none';
            this.expandToggleBtn.innerHTML = '📈';
            this.expandToggleBtn.title = '展开';
            this.container.style.height = 'auto';
        }

        if (this.isExpanded) {
            this.updateStatsDisplay();
        }
    }

    private async updateStatsDisplay() {
        if (!this.isExpanded) return;

        try {
            const todayTime = this.recordManager.getTodayFocusTime();
            const weekTime = this.recordManager.getWeekFocusTime();

            this.todayFocusDisplay.textContent = this.recordManager.formatTime(todayTime);
            this.weekFocusDisplay.textContent = this.recordManager.formatTime(weekTime);

            const dailyFocusGoalHours = this.settings.dailyFocusGoal ?? 0;
            if (dailyFocusGoalHours > 0) {
                const goalMinutes = dailyFocusGoalHours * 60;
                const progress = Math.min((todayTime / goalMinutes) * 100, 100);
                this.statsContainer.style.background = `linear-gradient(to right, var(--b3-card-success-background) ${progress}%, var(--b3-theme-surface) ${progress}%)`;

                if (todayTime >= goalMinutes) {
                    this.todayFocusDisplay.style.color = 'rgb(76, 175, 80)';
                } else {
                    this.todayFocusDisplay.style.color = '#FF6B6B';
                }
            } else {
                this.statsContainer.style.background = 'var(--b3-theme-surface)';
                this.todayFocusDisplay.style.color = '#FF6B6B';
            }
        } catch (error) {
            console.error('更新统计显示失败:', error);
            this.todayFocusDisplay.textContent = '0m';
            this.weekFocusDisplay.textContent = '0m';
        }
    }

    private updateDisplay() {
        let displayTime: number;
        let minutes: number;
        let seconds: number;

        if (this.isCountUp) {
            // 正计时模式
            if (this.isWorkPhase) {
                // 工作时间：正计时显示
                displayTime = this.timeElapsed;
                minutes = Math.floor(displayTime / 60);
                seconds = displayTime % 60;
            } else {
                // 休息时间：倒计时显示
                displayTime = this.breakTimeLeft;
                minutes = Math.floor(displayTime / 60);
                seconds = displayTime % 60;
            }
        } else {
            // 倒计时模式
            displayTime = this.timeLeft;
            minutes = Math.floor(displayTime / 60);
            seconds = displayTime % 60;
        }

        this.timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // 进度条逻辑
        let progress: number;
        const circumference = 2 * Math.PI * 36;

        if (this.isCountUp && this.isWorkPhase) {
            // 正计时工作时间：根据番茄时长计算当前番茄的进度
            const pomodoroLength = this.settings.workDuration * 60;
            const currentCycleTime = this.timeElapsed % pomodoroLength;
            progress = currentCycleTime / pomodoroLength;
        } else if (this.isCountUp && !this.isWorkPhase) {
            // 正计时休息时间：倒计时进度
            const totalBreakTime = this.isLongBreak ?
                this.settings.longBreakDuration * 60 :
                this.settings.breakDuration * 60;
            progress = (totalBreakTime - this.breakTimeLeft) / totalBreakTime;
        } else {
            // 倒计时模式
            progress = ((this.totalTime - this.timeLeft) / this.totalTime);
        }

        const offset = circumference * (1 - progress);
        this.circularProgress.style.strokeDashoffset = offset.toString();

        // 更新颜色和状态显示
        let color = '#FF6B6B';
        let statusText = t('pomodoroWork') || '工作时间';
        let statusIconHtml = '🍅';

        if (!this.isWorkPhase) {
            if (this.isLongBreak) {
                color = '#9C27B0';
                statusText = t('pomodoroLongBreak') || '长时休息';
                statusIconHtml = '🧘‍♀️';
            } else {
                color = '#4CAF50';
                statusText = t('pomodoroBreak') || '短时休息';
                statusIconHtml = '🍵';
            }
        }

        this.circularProgress.setAttribute('stroke', color);
        this.statusDisplay.textContent = statusText;

        // 更新状态图标
        const statusIcon = this.container.querySelector('.pomodoro-status-icon');
        if (statusIcon) {
            statusIcon.innerHTML = statusIconHtml;
        }

        // 更新番茄数量
        const pomodoroCountElement = this.container.querySelector('#pomodoroCount');
        if (pomodoroCountElement) {
            pomodoroCountElement.textContent = this.completedPomodoros.toString();
        }

        // 更新按钮状态和位置
        if (!this.isRunning) {
            this.startPauseBtn.innerHTML = '▶️';
            // 重置按钮位置
            this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
            this.stopBtn.style.display = 'none';
        } else if (this.isPaused) {
            this.startPauseBtn.innerHTML = '▶️';
            this.stopBtn.style.display = 'flex';
            // 暂停状态下不自动设置位置，让mouseenter事件处理
        } else {
            this.startPauseBtn.innerHTML = '⏸';
            // 重置按钮位置
            this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
            this.stopBtn.style.display = 'none';
        }

        // 如果是最小化状态，更新最小化显示
        if (this.isMinimized) {
            this.updateMinimizedDisplay();
            return;
        }
    }

    private toggleTimer() {
        // 确保在用户手势上下文中初始化音频
        if (!this.audioInitialized) {
            this.initializeAudioPlayback();
        }

        if (!this.isRunning) {
            this.startTimer();
        } else {
            if (this.isPaused) {
                this.resumeTimer();
            } else {
                this.pauseTimer();
                // 暂停后立即显示继续和停止按钮
                const statusIcon = this.container.querySelector('.pomodoro-status-icon');
                if (statusIcon) {
                    statusIcon.style.opacity = '0.3';
                }
                this.startPauseBtn.style.opacity = '1';
                this.stopBtn.style.opacity = '1';
                this.stopBtn.style.display = 'flex';
                this.startPauseBtn.style.transform = 'translate(-50%, -50%) translateX(-12px)';
                this.stopBtn.style.transform = 'translate(-50%, -50%) translateX(12px)';
            }
        }

        // 立即更新显示
        this.updateDisplay();
    }

    private async startTimer() {
        this.isRunning = true;
        this.isPaused = false;

        // 改进的时间继承逻辑
        if (this.startTime === 0) {
            // 新番茄钟或重置后的首次启动
            if (this.isCountUp) {
                // 正计时模式：从已有的时间开始
                this.startTime = Date.now() - (this.timeElapsed * 1000);
            } else {
                // 倒计时模式：从已有的进度开始
                const elapsedTime = this.totalTime - this.timeLeft;
                this.startTime = Date.now() - (elapsedTime * 1000);
            }
        } else {
            // 继承状态后的启动，调整开始时间以保持正确的经过时间
            if (this.isCountUp) {
                if (this.isWorkPhase) {
                    // 正计时工作时间：基于当前已用时间重新计算开始时间
                    this.startTime = Date.now() - (this.timeElapsed * 1000);
                } else {
                    // 正计时休息时间：基于剩余时间重新计算开始时间
                    const totalBreakTime = this.isLongBreak ?
                        this.settings.longBreakDuration * 60 :
                        this.settings.breakDuration * 60;
                    const usedBreakTime = totalBreakTime - this.breakTimeLeft;
                    this.startTime = Date.now() - (usedBreakTime * 1000);
                }
            } else {
                // 倒计时模式：基于剩余时间重新计算开始时间
                const elapsedTime = this.totalTime - this.timeLeft;
                this.startTime = Date.now() - (elapsedTime * 1000);
            }
        }

        this.lastUpdateTime = Date.now();

        // 播放对应的背景音
        if (this.isWorkPhase && this.workAudio) {
            await this.safePlayAudio(this.workAudio);
        } else if (!this.isWorkPhase) {
            if (this.isLongBreak && this.longBreakAudio) {
                await this.safePlayAudio(this.longBreakAudio);
            } else if (!this.isLongBreak && this.breakAudio) {
                await this.safePlayAudio(this.breakAudio);
            }
        }

        // 启动随机提示音定时器（仅在工作时间）
        if (this.isWorkPhase) {
            this.startRandomNotificationTimer();
        }

        this.timer = window.setInterval(() => {
            const currentTime = Date.now();
            const elapsedSinceStart = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                if (this.isWorkPhase) {
                    // 正计时工作时间：直接使用经过的时间
                    this.timeElapsed = elapsedSinceStart;

                    // 检查是否完成一个番茄
                    const pomodoroLength = this.settings.workDuration * 60;
                    const currentCycleTime = this.timeElapsed % pomodoroLength;

                    if (this.timeElapsed > 0 && currentCycleTime === 0) {
                        this.completePomodoroPhase();
                    }
                } else {
                    // 正计时休息时间：倒计时显示
                    const totalBreakTime = this.isLongBreak ?
                        this.settings.longBreakDuration * 60 :
                        this.settings.breakDuration * 60;

                    this.breakTimeLeft = totalBreakTime - elapsedSinceStart;

                    if (this.breakTimeLeft <= 0) {
                        this.breakTimeLeft = 0;
                        this.completeBreakPhase();
                    }
                }
            } else {
                // 倒计时模式：从总时间减去经过的时间
                this.timeLeft = this.totalTime - elapsedSinceStart;

                if (this.timeLeft <= 0) {
                    this.timeLeft = 0;
                    this.completePhase();
                }
            }

            this.updateDisplay();
        }, 500);

        const phaseText = this.isWorkPhase ? '工作时间' : (this.isLongBreak ? '长时休息' : '短时休息');
        const modeText = (this.isCountUp && this.isWorkPhase) ? '正计时' : '倒计时';
        showMessage(`${phaseText}${modeText}继续进行中`);

        // 更新显示
        this.updateDisplay();
    }
    private pauseTimer() {
        this.isPaused = true;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // 记录暂停时已经经过的时间
        const currentTime = Date.now();
        this.pausedTime = currentTime - this.startTime;

        // 停止随机提示音定时器
        this.stopRandomNotificationTimer();

        // 暂停所有背景音
        if (this.workAudio) {
            this.workAudio.pause();
        }
        if (this.breakAudio) {
            this.breakAudio.pause();
        }
        if (this.longBreakAudio) {
            this.longBreakAudio.pause();
        }

        // 更新显示
        this.updateDisplay();
    }

    private async resumeTimer() {
        this.isPaused = false;

        // 重新计算开始时间，保持已暂停的时间
        this.startTime = Date.now() - this.pausedTime;

        // 恢复对应的背景音
        if (this.isWorkPhase && this.workAudio) {
            await this.safePlayAudio(this.workAudio);
        } else if (!this.isWorkPhase) {
            if (this.isLongBreak && this.longBreakAudio) {
                await this.safePlayAudio(this.longBreakAudio);
            } else if (!this.isLongBreak && this.breakAudio) {
                await this.safePlayAudio(this.breakAudio);
            }
        }

        // 重新启动随机提示音定时器（仅在工作时间）
        if (this.isWorkPhase) {
            this.startRandomNotificationTimer();
        }

        this.timer = window.setInterval(() => {
            const currentTime = Date.now();

            const elapsedSinceStart = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                if (this.isWorkPhase) {
                    this.timeElapsed = elapsedSinceStart;

                    const pomodoroLength = this.settings.workDuration * 60;
                    const currentCycleTime = this.timeElapsed % pomodoroLength;

                    if (this.timeElapsed > 0 && currentCycleTime === 0) {
                        this.completePomodoroPhase();
                    }
                } else {
                    const totalBreakTime = this.isLongBreak ?
                        this.settings.longBreakDuration * 60 :
                        this.settings.breakDuration * 60;

                    this.breakTimeLeft = totalBreakTime - elapsedSinceStart;

                    if (this.breakTimeLeft <= 0) {
                        this.breakTimeLeft = 0;
                        this.completeBreakPhase();
                    }
                }
            } else {
                this.timeLeft = this.totalTime - elapsedSinceStart;

                if (this.timeLeft <= 0) {
                    this.timeLeft = 0;
                    this.completePhase();
                }
            }

            this.updateDisplay();
        }, 500);

        // 更新显示
        this.updateDisplay();
    }

    private async startWorkTime() {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomNotificationTimer(); // 停止随机提示音

        this.isWorkPhase = true;
        this.isLongBreak = false;
        this.isRunning = false;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间
        this.startTime = 0; // 重置开始时间

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = this.settings.workDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            // 不重置番茄计数，保持累计
            // this.completedPomodoros = 0;
        } else {
            this.timeLeft = this.settings.workDuration * 60;
            this.totalTime = this.timeLeft;
        }

        this.updateDisplay();
        showMessage('💪 ' + (t('pomodoroWork') || '开始工作时间'));
    }

    private async startShortBreak() {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomNotificationTimer(); // 停止随机提示音

        this.isWorkPhase = false;
        this.isLongBreak = false;
        this.isRunning = false;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间
        this.startTime = 0; // 重置开始时间

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = this.settings.breakDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            this.breakTimeLeft = this.settings.breakDuration * 60;
        } else {
            this.timeLeft = this.settings.breakDuration * 60;
            this.totalTime = this.timeLeft;
        }

        this.updateDisplay();
        showMessage('🍵 ' + (t('pomodoroBreak') || '开始短时休息'));
    }

    private async startLongBreak() {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomNotificationTimer(); // 停止随机提示音

        this.isWorkPhase = false;
        this.isLongBreak = true;
        this.isRunning = false;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间
        this.startTime = 0; // 重置开始时间

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = this.settings.longBreakDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            this.breakTimeLeft = this.settings.longBreakDuration * 60;
        } else {
            this.timeLeft = this.settings.longBreakDuration * 60;
            this.totalTime = this.timeLeft;
        }

        this.updateDisplay();
        showMessage('🧘 ' + (t('pomodoroLongBreak') || '开始长时休息'));
    }

    private async resetTimer() {
        // 如果是正计时工作模式下手动停止，并且有专注时间，则记录
        if (this.isCountUp && this.isWorkPhase && this.timeElapsed > 0) {
            const eventId = this.reminder.isRepeatInstance ? this.reminder.originalId : this.reminder.id;
            const eventTitle = this.reminder.title || '番茄专注';
            // 记录实际花费的时间
            await this.recordManager.recordWorkSession(
                Math.floor(this.timeElapsed / 60),
                eventId,
                eventTitle,
                this.currentPhaseOriginalDuration,
                false // isCompleted - false 因为是手动停止
            );
            // 更新统计显示
            this.updateStatsDisplay();
        }
        this.isRunning = false;
        this.isPaused = false;
        this.isWorkPhase = true;
        this.isLongBreak = false;
        this.timeElapsed = 0;
        this.breakTimeLeft = 0;
        this.pausedTime = 0; // 重置暂停时间
        this.startTime = 0; // 重置开始时间
        // 注释掉清空番茄计数的代码，保持总计数
        // this.completedPomodoros = 0;
        this.statusDisplay.textContent = '工作时间';

        // 重置当前阶段的原始时长为工作时长
        this.currentPhaseOriginalDuration = this.settings.workDuration;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomNotificationTimer(); // 停止随机提示音

        if (this.isCountUp) {
            this.timeElapsed = 0;
        } else {
            this.timeLeft = this.settings.workDuration * 60;
            this.totalTime = this.timeLeft;
        }

        // 重置按钮位置
        this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
        this.stopBtn.style.display = 'none';
        this.stopBtn.style.transform = 'translate(-50%, -50%) translateX(16px)';

        this.updateDisplay();

        // 非自动模式下，更新统计显示
        if (!this.autoMode) {
            setTimeout(() => {
                this.updateStatsDisplay();
            }, 100);
        }
    }

    /**
     * 初始化系统弹窗功能
     */
    private async initSystemNotification() {
        if (!this.systemNotificationEnabled) {
            return;
        }

        try {
            // 动态导入node-notifier，避免在不支持的环境中报错
            if (typeof require !== 'undefined') {
                console.log('系统弹窗功能已启用');
            }
        } catch (error) {
            console.warn('初始化系统弹窗失败，将禁用此功能:', error);
            this.systemNotificationEnabled = false;
        }
    }

    /**
     * 显示系统弹窗通知
     */
    private showSystemNotification(title: string, message: string, type: 'work' | 'break' | 'longBreak' = 'work') {
        if (!this.systemNotificationEnabled) {
            return;
        }

        try {
            if ('Notification' in window && Notification.permission === 'granted') {
                // 使用浏览器通知作为备选方案
                const notification = new Notification(title, {
                    body: message,
                    requireInteraction: true,
                    silent: false// 使用我们自己的音频
                });

                // 点击通知时的处理
                notification.onclick = () => {
                    window.focus();
                    notification.close();
                };

            }
        } catch (error) {
            console.warn('显示系统弹窗失败:', error);
        }
    }


    // 完成番茄阶段（正计时模式）
    private async completePomodoroPhase() {
        // 正计时模式下不停止计时器，只记录番茄数量
        if (!this.isCountUp) {
            // 倒计时模式才停止计时器
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }

            this.stopAllAudio();
            this.stopRandomNotificationTimer(); // 添加停止随机提示音

            // 播放工作结束提示音
            if (this.workEndAudio) {
                await this.safePlayAudio(this.workEndAudio);
            }

            // 显示系统弹窗通知
            if (this.systemNotificationEnabled) {
                const eventTitle = this.reminder.title || '番茄专注';
                this.showSystemNotification(
                    '🍅 工作番茄完成！',
                    `「${eventTitle}」的工作时间已结束，是时候休息一下了！`,
                    'work'
                );
            } else {
                // 只有在系统弹窗关闭时才显示思源笔记弹窗
                showMessage('🍅 工作番茄完成！开始休息吧～', 3000);
            }

            // 切换到休息阶段
            this.isWorkPhase = false;
            this.isLongBreak = false;
            this.isRunning = false;
            this.isPaused = false;
            this.breakTimeLeft = this.settings.breakDuration * 60;

            this.updateDisplay();

            setTimeout(() => {
                this.updateStatsDisplay();
            }, 100);
        } else {
            // 正计时模式完成番茄后也要停止随机提示音
            this.stopRandomNotificationTimer();
        }        // 无论哪种模式都记录完成的工作番茄
        const eventId = this.reminder.isRepeatInstance ? this.reminder.originalId : this.reminder.id;
        const eventTitle = this.reminder.title || '番茄专注';

        // 使用当前阶段的实际设定时长进行记录
        await this.recordManager.recordWorkSession(
            this.currentPhaseOriginalDuration,
            eventId,
            eventTitle,
            this.currentPhaseOriginalDuration,
            true
        );

        // 更新番茄数量
        this.completedPomodoros++;
        await this.updateReminderPomodoroCount();

        // 正计时模式下静默更新统计，不发送消息
        if (this.isCountUp) {
            setTimeout(() => {
                this.updateStatsDisplay();
                this.updateDisplay(); // 更新番茄数量显示
            }, 100);
        }
    }

    // 完成休息阶段（正计时模式）
    private async completeBreakPhase() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.stopAllAudio();
        this.stopRandomNotificationTimer(); // 添加停止随机提示音

        // 播放休息结束提示音
        if (this.breakEndAudio) {
            await this.safePlayAudio(this.breakEndAudio);
        }

        // 显示系统弹窗通知
        const breakType = this.isLongBreak ? '长时休息' : '短时休息';

        if (this.systemNotificationEnabled) {
            const eventTitle = this.reminder.title || '番茄专注';
            this.showSystemNotification(
                `☕ ${breakType}结束！`,
                `「${eventTitle}」的${breakType}已结束，准备开始下一个工作阶段吧！`,
                this.isLongBreak ? 'longBreak' : 'break'
            );
        }

        // 记录完成的休息时间
        const eventId = this.reminder.isRepeatInstance ? this.reminder.originalId : this.reminder.id;
        const eventTitle = this.reminder.title || '番茄专注';

        await this.recordManager.recordBreakSession(
            this.currentPhaseOriginalDuration,
            eventId,
            eventTitle,
            this.currentPhaseOriginalDuration,
            this.isLongBreak,
            true
        );

        // 检查是否启用自动模式并进入下一阶段
        if (this.autoMode) {

            showMessage(`☕ ${breakType}结束！自动开始下一个工作阶段`, 3000);


            // 自动切换到工作阶段
            setTimeout(() => {
                this.autoSwitchToWork();
            }, 1000); // 延迟1秒切换
        } else {
            showMessage(`☕ ${breakType}结束！自动开始下一个工作阶段`, 3000);


            // 切换到工作阶段
            this.isWorkPhase = true;
            this.isLongBreak = false;
            this.isRunning = false;
            this.isPaused = false;
            this.breakTimeLeft = 0;

            this.updateDisplay();

            setTimeout(() => {
                this.updateStatsDisplay();
            }, 100);
        }
    }

    // 完成阶段（倒计时模式）
    private async completePhase() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomNotificationTimer(); // 添加停止随机提示音

        if (this.isWorkPhase) {
            // 工作阶段结束，停止随机提示音
            // 显示系统弹窗通知
            if (this.systemNotificationEnabled) {
                const eventTitle = this.reminder.title || '番茄专注';
                this.showSystemNotification(
                    '🍅 工作时间结束！',
                    `「${eventTitle}」的工作时间已结束，是时候休息一下了！`,
                    'work'
                );
            }

            // 播放工作结束提示音

            if (this.workEndAudio) {
                await this.safePlayAudio(this.workEndAudio);
            }            // 记录完成的工作番茄
            const eventId = this.reminder.isRepeatInstance ? this.reminder.originalId : this.reminder.id;
            const eventTitle = this.reminder.title || '番茄专注';

            await this.recordManager.recordWorkSession(
                this.currentPhaseOriginalDuration,
                eventId,
                eventTitle,
                this.currentPhaseOriginalDuration,
                true
            );

            // 更新番茄数量计数
            this.completedPomodoros++;
            await this.updateReminderPomodoroCount();

            // 判断是否应该进入长休息
            const shouldTakeLongBreak = this.completedPomodoros > 0 &&
                this.completedPomodoros % this.longBreakInterval === 0;

            // 检查是否启用自动模式
            if (this.autoMode) {
                // 只有在系统弹窗关闭时才显示思源笔记弹窗
                if (!this.systemNotificationEnabled) {
                    showMessage('🍅 工作时间结束！自动开始休息', 3000);
                }

                // 自动切换到休息阶段
                setTimeout(() => {
                    this.autoSwitchToBreak(shouldTakeLongBreak);
                }, 1000);
            } else {                // 非自动模式下，也要根据番茄钟数量判断休息类型
                if (shouldTakeLongBreak) {
                    // 只有在系统弹窗关闭时才显示思源笔记弹窗
                    if (!this.systemNotificationEnabled) {
                        showMessage(`🍅 工作时间结束！已完成${this.completedPomodoros}个番茄，开始长时休息`, 3000);
                    }
                    this.isWorkPhase = false;
                    this.isLongBreak = true;
                    this.statusDisplay.textContent = '长时休息';
                    this.timeLeft = this.settings.longBreakDuration * 60;
                    this.totalTime = this.timeLeft;
                    // 设置当前阶段的原始时长
                    this.currentPhaseOriginalDuration = this.settings.longBreakDuration;
                } else {
                    // 只有在系统弹窗关闭时才显示思源笔记弹窗
                    if (!this.systemNotificationEnabled) {
                        showMessage('🍅 工作时间结束！开始短时休息', 3000);
                    }
                    this.isWorkPhase = false;
                    this.isLongBreak = false;
                    this.statusDisplay.textContent = '短时休息';
                    this.timeLeft = this.settings.breakDuration * 60;
                    this.totalTime = this.timeLeft;
                    // 设置当前阶段的原始时长
                    this.currentPhaseOriginalDuration = this.settings.breakDuration;
                }
                this.isRunning = false;
                this.isPaused = false;
                this.updateDisplay();
            }
        } else {
            // 播放休息结束提示音
            if (this.breakEndAudio) {
                await this.safePlayAudio(this.breakEndAudio);
            }

            // 记录完成的休息时间
            const eventId = this.reminder.isRepeatInstance ? this.reminder.originalId : this.reminder.id;
            const eventTitle = this.reminder.title || '番茄专注';

            await this.recordManager.recordBreakSession(
                this.currentPhaseOriginalDuration,
                eventId,
                eventTitle,
                this.currentPhaseOriginalDuration,
                this.isLongBreak,
                true
            );

            const breakType = this.isLongBreak ? '长时休息' : '短时休息';

            // 显示系统弹窗通知
            if (this.systemNotificationEnabled) {
                const eventTitle = this.reminder.title || '番茄专注';
                this.showSystemNotification(
                    `☕ ${breakType}结束！`,
                    `「${eventTitle}」的${breakType}已结束，准备开始下一个番茄钟吧！`,
                    this.isLongBreak ? 'longBreak' : 'break'
                );
            }

            // 检查是否启用自动模式
            if (this.autoMode) {
                // 只有在系统弹窗关闭时才显示思源笔记弹窗
                showMessage(`☕ ${breakType}结束！自动开始下一个番茄钟`, 3000);

                // 自动切换到工作阶段
                setTimeout(() => {
                    this.autoSwitchToWork();
                }, 1000);
            } else {
                // 只有在系统弹窗关闭时才显示思源笔记弹窗
                if (!this.systemNotificationEnabled) {
                    showMessage(`☕ ${breakType}结束！准备开始下一个番茄钟`, 3000);
                }
                this.isWorkPhase = true;
                this.isLongBreak = false;
                this.statusDisplay.textContent = '工作时间';
                this.timeLeft = this.settings.workDuration * 60;
                this.totalTime = this.timeLeft;
                // 设置当前阶段的原始时长
                this.currentPhaseOriginalDuration = this.settings.workDuration;
                this.isRunning = false;
                this.isPaused = false;
                this.updateDisplay();
            }
        }

        // 如果不是自动模式，更新统计显示
        if (!this.autoMode) {
            setTimeout(() => {
                this.updateStatsDisplay();
            }, 100);
        }
    }
    /**
 * 自动切换到休息阶段
 * @param isLongBreak 是否为长休息
 */
    private async autoSwitchToBreak(isLongBreak: boolean = false) {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        // 停止所有音频和定时器
        this.stopAllAudio();
        this.stopRandomNotificationTimer();
        if (this.autoTransitionTimer) {
            clearTimeout(this.autoTransitionTimer);
            this.autoTransitionTimer = null;
        }

        // 设置休息阶段
        this.isWorkPhase = false;
        this.isLongBreak = isLongBreak;
        this.isRunning = true;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间

        const breakDuration = isLongBreak ? this.settings.longBreakDuration : this.settings.breakDuration;

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = breakDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            this.breakTimeLeft = breakDuration * 60;
        } else {
            this.timeLeft = breakDuration * 60;
            this.totalTime = this.timeLeft;
        }

        // 播放对应的背景音
        if (isLongBreak && this.longBreakAudio) {
            await this.safePlayAudio(this.longBreakAudio);
        } else if (!isLongBreak && this.breakAudio) {
            await this.safePlayAudio(this.breakAudio);
        }

        // 开始计时
        this.startTime = Date.now();
        this.timer = window.setInterval(() => {
            const currentTime = Date.now();
            const elapsedSinceStart = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                this.breakTimeLeft = breakDuration * 60 - elapsedSinceStart;
                if (this.breakTimeLeft <= 0) {
                    this.breakTimeLeft = 0;
                    this.completeBreakPhase();
                }
            } else {
                this.timeLeft = this.totalTime - elapsedSinceStart;
                if (this.timeLeft <= 0) {
                    this.timeLeft = 0;
                    this.completePhase();
                }
            }
            this.updateDisplay();
        }, 500);

        this.updateDisplay();
        this.updateStatsDisplay();

        const breakType = isLongBreak ? '长时休息' : '短时休息';
        console.log(`自动模式：开始${breakType}`);
    }

    /**
     * 自动切换到工作阶段
     */
    private async autoSwitchToWork() {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        // 停止所有音频和定时器
        this.stopAllAudio();
        this.stopRandomNotificationTimer();
        if (this.autoTransitionTimer) {
            clearTimeout(this.autoTransitionTimer);
            this.autoTransitionTimer = null;
        }

        // 设置工作阶段
        this.isWorkPhase = true;
        this.isLongBreak = false;
        this.isRunning = true;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = this.settings.workDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            this.breakTimeLeft = 0;
        } else {
            this.timeLeft = this.settings.workDuration * 60;
            this.totalTime = this.timeLeft;
        }

        // 播放工作背景音
        if (this.workAudio) {
            await this.safePlayAudio(this.workAudio);
        }

        // 启动随机提示音定时器
        if (this.isWorkPhase) {
            this.startRandomNotificationTimer();
        }

        // 开始计时
        this.startTime = Date.now();
        this.timer = window.setInterval(() => {
            const currentTime = Date.now();
            const elapsedSinceStart = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                this.timeElapsed = elapsedSinceStart;

                const pomodoroLength = this.settings.workDuration * 60;
                const currentCycleTime = this.timeElapsed % pomodoroLength;
                if (this.timeElapsed > 0 && currentCycleTime === 0) {
                    this.completePomodoroPhase();
                }
            } else {
                this.timeLeft = this.totalTime - elapsedSinceStart;
                if (this.timeLeft <= 0) {
                    this.timeLeft = 0;
                    this.completePhase();
                }
            }
            this.updateDisplay();
        }, 500);

        this.updateDisplay();
        this.updateStatsDisplay();

        console.log('自动模式：开始工作时间');
    }

    private stopAllAudio() {
        if (this.workAudio) {
            this.workAudio.pause();
            this.workAudio.currentTime = 0;
        }
        if (this.breakAudio) {
            this.breakAudio.pause();
            this.breakAudio.currentTime = 0;
        }
        if (this.longBreakAudio) {
            this.longBreakAudio.pause();
            this.longBreakAudio.currentTime = 0;
        }
    }

    private async updateReminderPomodoroCount() {
        try {
            const reminderData = await readReminderData();

            let targetId: string;
            if (this.reminder.isRepeatInstance) {
                targetId = this.reminder.originalId;
            } else {
                targetId = this.reminder.id;
            }

            if (reminderData[targetId]) {
                if (typeof reminderData[targetId].pomodoroCount !== 'number') {
                    reminderData[targetId].pomodoroCount = 0;
                }

                reminderData[targetId].pomodoroCount++;
                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                console.log(`提醒 ${targetId} 的番茄数量已更新为: ${reminderData[targetId].pomodoroCount}`);
            } else {
                console.warn('未找到对应的提醒项:', targetId);
            }
        } catch (error) {
            console.error('更新提醒番茄数量失败:', error);
        }
    }

    private editTime() {
        // 如果正在运行且未暂停，则不允许编辑
        if (this.isRunning && !this.isPaused) {

            showMessage('请先暂停计时器再编辑时间', 2000);
            return;
        }

        let currentTimeString: string;

        if (this.isCountUp) {
            if (this.isWorkPhase) {
                // 正计时工作模式，不允许编辑
                return;
            } else {
                // 正计时休息模式，编辑剩余休息时间
                const currentMinutes = Math.floor(this.breakTimeLeft / 60);
                const currentSeconds = this.breakTimeLeft % 60;
                currentTimeString = `${currentMinutes.toString().padStart(2, '0')}:${currentSeconds.toString().padStart(2, '0')}`;
            }
        } else {
            // 倒计时模式，编辑当前时间
            const currentMinutes = Math.floor(this.timeLeft / 60);
            const currentSeconds = this.timeLeft % 60;
            currentTimeString = `${currentMinutes.toString().padStart(2, '0')}:${currentSeconds.toString().padStart(2, '0')}`;
        }

        // 创建输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTimeString;

        // 根据是否全屏模式设置不同的样式
        if (this.isFullscreen) {
            input.style.cssText = `
                font-size: 20vh !important;
                font-weight: 600 !important;
                color: var(--b3-theme-on-surface);
                background: transparent;
                border: 2px solid var(--b3-theme-primary);
                border-radius: 8px;
                padding: 2vh 1vw;
                width: 60vw;
                text-align: center;
                font-variant-numeric: tabular-nums;
                outline: none;
                text-shadow: 0 0 20px rgba(255, 255, 255, 0.3);
                line-height: 1;
                font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            `;
        } else {
            input.style.cssText = `
                font-size: 24px;
                font-weight: 700;
                color: var(--b3-theme-on-surface);
                background: var(--b3-theme-surface);
                border: 2px solid var(--b3-theme-primary);
                border-radius: 4px;
                padding: 2px 4px;
                width: 80px;
                text-align: center;
                font-variant-numeric: tabular-nums;
                outline: none;
            `;
        }
        input.placeholder = 'MM:SS';

        // 替换时间显示
        const parent = this.timeDisplay.parentNode;
        parent.replaceChild(input, this.timeDisplay);
        input.focus();
        input.select();

        // 标记编辑状态，防止重复操作
        let isEditingFinished = false;

        // 处理输入完成
        const finishEdit = () => {
            if (isEditingFinished) return;
            isEditingFinished = true;

            // 检查输入框是否仍在父节点中
            if (input.parentNode !== parent) {
                return;
            }

            const inputValue = input.value.trim();
            let newTimeInSeconds = this.parseTimeStringToSeconds(inputValue);

            if (newTimeInSeconds === null) {
                showMessage(t('invalidTimeFormat') || '时间格式无效，请使用 MM:SS 格式（如 25:00）', 3000);
                parent.replaceChild(this.timeDisplay, input);
                return;
            }

            // 限制时间范围（1秒到999分59秒）
            if (newTimeInSeconds < 1 || newTimeInSeconds > 59999) {
                showMessage(t('timeRangeLimit') || '时间必须在 00:01 到 999:59 之间', 3000);
                parent.replaceChild(this.timeDisplay, input);
                return;
            }            // 更新对应的时间
            if (this.isCountUp && !this.isWorkPhase) {
                // 正计时休息模式
                this.breakTimeLeft = newTimeInSeconds;
                // 更新当前休息阶段的原始时长
                this.currentPhaseOriginalDuration = Math.floor(newTimeInSeconds / 60);
            } else if (!this.isCountUp) {
                // 倒计时模式
                this.timeLeft = newTimeInSeconds;
                this.totalTime = newTimeInSeconds;
                // 更新当前阶段的原始时长
                this.currentPhaseOriginalDuration = Math.floor(newTimeInSeconds / 60);
            }

            // 恢复时间显示
            parent.replaceChild(this.timeDisplay, input);
            this.updateDisplay();

            const minutes = Math.floor(newTimeInSeconds / 60);
            const seconds = newTimeInSeconds % 60;
            const phaseText = this.isWorkPhase ? (t('pomodoroWork') || '工作时间') : (this.isLongBreak ? (t('pomodoroLongBreak') || '长时休息') : (t('pomodoroBreak') || '短时休息'));
            showMessage(`${phaseText}${t('setTo') || '已设置为'} ${minutes}:${seconds.toString().padStart(2, '0')}`, 2000);
        };

        // 处理取消编辑
        const cancelEdit = () => {
            if (isEditingFinished) return;
            isEditingFinished = true;

            // 检查输入框是否仍在父节点中
            if (input.parentNode === parent) {
                parent.replaceChild(this.timeDisplay, input);
            }
        };

        // 事件监听
        input.addEventListener('blur', finishEdit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        });

        // 限制输入格式
        input.addEventListener('input', (e) => {
            let value = input.value;
            value = value.replace(/[^0-9:]/g, '')

            if (value.length > 5) {
                value = value.substring(0, 5);
            }

            if (value.length === 2 && value.indexOf(':') === -1) {
                value += ':';
            }

            input.value = value;
        });
    }

    private parseTimeStringToSeconds(timeStr: string): number | null {
        if (!timeStr) return null;

        let minutes = 0;
        let seconds = 0;

        if (timeStr.includes(':')) {
            const parts = timeStr.split(':');
            if (parts.length !== 2) return null;

            minutes = parseInt(parts[0], 10);
            seconds = parseInt(parts[1], 10);
        } else {
            minutes = parseInt(timeStr, 10);
            seconds = 0;
        }

        if (isNaN(minutes) || isNaN(seconds)) return null;
        if (minutes < 0 || seconds < 0) return null;
        if (seconds >= 60) return null;

        return minutes * 60 + seconds;
    }

    show() {
        // 如果番茄钟继承了运行状态，自动开始计时
        setTimeout(() => {
            if (this.isRunning && !this.isPaused) {
                this.startTimer();
            }
        }, 100);
    }

    /**
     * 设置计时模式
     * @param isCountUp true为正计时模式，false为倒计时模式
     */
    public setCountUpMode(isCountUp: boolean) {
        // 如果正在运行，先停止
        if (this.isRunning) {
            this.resetTimer();
        }

        this.isCountUp = isCountUp;

        // 更新模式切换按钮标题
        this.modeToggleBtn.title = this.isCountUp ? '切换到倒计时' : '切换到正计时';

        // 更新标题图标
        const titleIcon = this.container.querySelector('.pomodoro-title span');
        if (titleIcon) {
            titleIcon.textContent = this.isCountUp ? '🍅' : '🍅';
        }

        // 重置状态并更新显示
        this.resetTimer();
    }

    close() {
        this.isWindowClosed = true; // 标记窗口已关闭

        if (this.timer) {
            clearInterval(this.timer);
        }

        // 清理自动切换定时器
        if (this.autoTransitionTimer) {
            clearTimeout(this.autoTransitionTimer);
            this.autoTransitionTimer = null;
        }

        this.stopAllAudio();
        this.stopRandomNotificationTimer(); // 停止随机提示音
        this.detachAudioUnlockListeners();

        if (this.isFullscreen) {
            this.exitFullscreen();
        }
        if (this.exitFullscreenBtn && this.exitFullscreenBtn.parentNode) {
            this.exitFullscreenBtn.parentNode.removeChild(this.exitFullscreenBtn);
        }

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }

    destroy() {
        this.isWindowClosed = true; // 标记窗口已关闭
        this.close();
    }

    /**
     * 检查番茄钟窗口是否仍然存在
     * @returns 如果窗口存在且未被关闭返回true，否则返回false
     */
    public isWindowActive(): boolean {
        if (this.isWindowClosed) {
            return false;
        }

        // 检查DOM元素是否仍然存在且在文档中
        return this.container &&
            this.container.parentNode &&
            document.contains(this.container);
    }

    /**
     * 外部暂停番茄钟（供其他组件调用）
     */
    public pauseFromExternal() {
        if (this.isRunning && !this.isPaused) {
            this.pauseTimer();
        }
    }

    /**
     * 外部恢复番茄钟（供其他组件调用）
     */
    public resumeFromExternal() {
        if (this.isRunning && this.isPaused) {
            this.resumeTimer();
        }
    }

    /**
     * 打开相关笔记
     */
    private async openRelatedNote() {
        try {
            // 获取块ID
            let blockId = this.reminder.blockId;

            // 如果是重复事件实例，使用原始事件的blockId
            if (this.reminder.isRepeatInstance && this.reminder.originalId) {
                const reminderData = await readReminderData();
                const originalReminder = reminderData[this.reminder.originalId];
                if (originalReminder) {
                    blockId = originalReminder.blockId;
                }
            }

            if (!blockId) {
                showMessage("无法获取笔记ID", 2000);
                return;
            }

            // 检查块是否存在
            const block = await getBlockByID(blockId);
            if (!block) {
                showMessage("笔记不存在或已被删除", 3000);
                return;
            }

            openBlock(blockId)

            showMessage("正在打开笔记...", 1000);

        } catch (error) {
            console.error('打开笔记失败:', error);
            showMessage("打开笔记失败", 2000);
        }
    }

    private toggleFullscreen() {
        if (this.isFullscreen) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    private enterFullscreen() {
        this.isFullscreen = true;
        this.container.classList.add('fullscreen');

        // 创建退出全屏按钮
        this.exitFullscreenBtn = document.createElement('button');
        this.exitFullscreenBtn.className = 'pomodoro-exit-fullscreen';
        this.exitFullscreenBtn.textContent = t('exitFullscreen') || '退出全屏';
        this.exitFullscreenBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.exitFullscreen();
        });
        document.body.appendChild(this.exitFullscreenBtn);

        this.addEscapeKeyListener();
        showMessage('已进入全屏模式，按ESC或点击右上角按钮退出', 2000);
    }

    private exitFullscreen() {
        this.isFullscreen = false;
        this.container.classList.remove('fullscreen');

        // 移除退出全屏按钮
        if (this.exitFullscreenBtn && this.exitFullscreenBtn.parentNode) {
            this.exitFullscreenBtn.parentNode.removeChild(this.exitFullscreenBtn);
        }

        this.removeEscapeKeyListener();
        showMessage('已退出全屏模式', 1500);
    }

    private addEscapeKeyListener() {
        this.escapeKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.isFullscreen) {
                e.preventDefault();
                this.exitFullscreen();
            }
        };
        document.addEventListener('keydown', this.escapeKeyHandler);
    }

    private removeEscapeKeyListener() {
        if (this.escapeKeyHandler) {
            document.removeEventListener('keydown', this.escapeKeyHandler);
            this.escapeKeyHandler = null;
        }
    }
}

