/**
 * baeframe - Slack Notifier Module
 * Slack 워크플로 웹훅을 통한 알림 전송
 */

import { createLogger } from '../logger.js';
import { TEAM_MEMBERS, getSlackUidByName } from './team-members.js';
import { MentionManager } from './mention-manager.js';

const log = createLogger('SlackNotifier');

const WEBHOOK_URL = 'https://hooks.slack.com/triggers/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';

let instance = null;

/**
 * Slack 웹훅 알림 매니저
 */
export class SlackNotifier {
  constructor() {
    this._enabled = true;
    this._showToast = null; // app.js에서 주입
  }

  /**
   * 토스트 함수 설정 (app.js에서 호출)
   * @param {Function} toastFn - showToast 함수
   */
  setToastFunction(toastFn) {
    this._showToast = toastFn;
  }

  /**
   * 새 댓글 작성 시 @멘션 대상에게 알림
   * @param {object} marker - CommentMarker 객체
   * @param {string} currentAuthor - 현재 사용자 이름
   * @param {object} videoInfo - { filePath, fileName, timecode }
   */
  async notifyNewComment(marker, currentAuthor, videoInfo) {
    if (!this._enabled) return;

    try {
      const mentionedNames = MentionManager.parseMentions(marker.text);
      if (mentionedNames.length === 0) return;

      const senderUid = getSlackUidByName(currentAuthor);
      if (!senderUid) {
        log.warn('현재 사용자 Slack UID 없음', { currentAuthor });
        return;
      }

      let failCount = 0;
      for (const name of mentionedNames) {
        // 본인 제외
        if (name === currentAuthor) continue;

        const targetUid = getSlackUidByName(name);
        if (!targetUid) continue;

        const payload = {
          your_name: senderUid,
          target_name: targetUid,
          time: this._formatTime(new Date()),
          file_name: this._formatFileName(videoInfo),
          deep_link: this._buildDeepLink(videoInfo, marker.id),
          comment: marker.text,
          target_comment: ''
        };

        try {
          await this._sendWebhook(payload);
        } catch (err) {
          log.warn(`댓글 알림 전송 실패 (${name})`, err);
          failCount++;
        }
      }
      if (failCount > 0) {
        this._toast(`Slack 알림 ${failCount}건 전송 실패`, 'warning');
      }
    } catch (err) {
      log.warn('댓글 알림 처리 오류', err);
      this._toast('Slack 알림 전송 실패', 'warning');
    }
  }

  /**
   * 답글 작성 시 원작성자 + 스레드 참여자 + @멘션 대상에게 알림
   * @param {object} marker - 원본 CommentMarker 객체
   * @param {object} reply - 새로 추가된 Reply 객체
   * @param {string} currentAuthor - 현재 사용자 이름
   * @param {object} videoInfo - { filePath, fileName, timecode }
   */
  async notifyReply(marker, reply, currentAuthor, videoInfo) {
    if (!this._enabled) return;

    try {
      const senderUid = getSlackUidByName(currentAuthor);
      if (!senderUid) {
        log.warn('현재 사용자 Slack UID 없음', { currentAuthor });
        return;
      }

      // 알림 대상 수집 (Set으로 중복 제거)
      const targetNames = new Set();

      // 1. 원본 댓글 작성자
      if (marker.author) {
        targetNames.add(marker.author);
      }

      // 2. 기존 답글 작성자들
      if (marker.replies) {
        for (const r of marker.replies) {
          if (r.author && r.id !== reply.id) {
            targetNames.add(r.author);
          }
        }
      }

      // 3. 답글 내 @멘션 대상
      const mentionedNames = MentionManager.parseMentions(reply.text);
      for (const name of mentionedNames) {
        targetNames.add(name);
      }

      // 본인 제외
      targetNames.delete(currentAuthor);

      if (targetNames.size === 0) return;

      let failCount = 0;
      for (const name of targetNames) {
        const targetUid = getSlackUidByName(name);
        if (!targetUid) continue;

        const payload = {
          your_name: senderUid,
          target_name: targetUid,
          time: this._formatTime(new Date()),
          file_name: this._formatFileName(videoInfo),
          deep_link: this._buildDeepLink(videoInfo, marker.id),
          comment: reply.text,
          target_comment: marker.text
        };

        try {
          await this._sendWebhook(payload);
        } catch (err) {
          log.warn(`답글 알림 전송 실패 (${name})`, err);
          failCount++;
        }
      }
      if (failCount > 0) {
        this._toast(`Slack 알림 ${failCount}건 전송 실패`, 'warning');
      }
    } catch (err) {
      log.warn('답글 알림 처리 오류', err);
      this._toast('Slack 알림 전송 실패', 'warning');
    }
  }

  /**
   * 웹훅 HTTP POST (메인 프로세스 IPC 경유 — CSP 우회)
   */
  async _sendWebhook(payload) {
    log.info('웹훅 전송 payload', JSON.stringify(payload, null, 2));

    if (window.electronAPI?.sendSlackWebhook) {
      const result = await window.electronAPI.sendSlackWebhook(WEBHOOK_URL, payload);
      log.info('웹훅 응답', JSON.stringify(result));
      if (!result.success) {
        log.warn('웹훅 응답 오류', { status: result.status, body: result.body, error: result.error });
        throw new Error(`Slack 웹훅 실패 (${result.status || result.error || 'unknown'})`);
      }
    } else {
      log.warn('electronAPI.sendSlackWebhook 사용 불가');
      throw new Error('electronAPI.sendSlackWebhook 사용 불가');
    }
  }

  /**
   * 시간 포맷팅 (한국어)
   */
  _formatTime(date) {
    const y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${M}-${d} ${h}:${m}`;
  }

  /**
   * 파일명 + 타임코드 포맷팅
   */
  _formatFileName(videoInfo) {
    if (!videoInfo) return '';
    const name = videoInfo.fileName || '';
    const tc = videoInfo.timecode || '';
    return tc ? `${name} (${tc})` : name;
  }

  /**
   * 딥링크 생성 (Slack 버튼 URL은 https만 허용)
   * 웹 뷰어 URL에 baeframe:// 경로를 hash로 인코딩
   */
  _buildDeepLink(videoInfo, markerId) {
    if (!videoInfo) return '';
    // .bframe 경로 우선 사용 (댓글/리뷰 데이터 포함)
    const targetPath = videoInfo.bframePath || videoInfo.filePath;
    if (!targetPath) return '';
    // HTTPS 리다이렉트 → baeframe:// (Slack 버튼/링크 호환)
    let baeframeUrl = `baeframe://${targetPath}`;
    if (markerId) {
      baeframeUrl += `?comment=${encodeURIComponent(markerId)}`;
    }
    return `https://baeframe.vercel.app/open.html#open=${encodeURIComponent(baeframeUrl)}`;
  }

  /**
   * 토스트 알림 표시
   */
  _toast(message, type) {
    if (this._showToast) {
      this._showToast(message, type);
    }
  }

  get enabled() { return this._enabled; }
  set enabled(val) { this._enabled = !!val; }
}

/**
 * 싱글턴 인스턴스 반환
 * @returns {SlackNotifier}
 */
export function getSlackNotifier() {
  if (!instance) {
    instance = new SlackNotifier();
  }
  return instance;
}
