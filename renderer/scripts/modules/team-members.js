/**
 * baeframe - Team Members Module
 * 팀 멤버 이름 ↔ Slack UID 매핑
 */

export const TEAM_MEMBERS = [
  { name: '정영준', slackUid: 'U03LTQAAFSB', aliases: ['영준'] },
  { name: '장삐쭈', slackUid: 'U03MM2C4F4Z', aliases: ['삐쭈'] },
  { name: '허혜원', slackUid: 'U03M1Q37LDU', aliases: ['혜원', '모몽가'] },
  { name: '지정민', slackUid: 'U03MAQGMEN8', aliases: ['정민'] },
  { name: '안류천', slackUid: 'U03MAQH93BN', aliases: ['류천'] },
  { name: '강선영', slackUid: 'U03M8AVUC1H', aliases: ['선영'] },
  { name: '박정인', slackUid: 'U03M8AWB49Z', aliases: ['정인'] },
  { name: '윤성원', slackUid: 'U03H7Q88E1M', aliases: ['성원', 'SW', 'sw'] },
  { name: '원동우', slackUid: 'U03MM2B1W73', aliases: ['동우'] },
  { name: '이혜민', slackUid: 'U03PN339U4E', aliases: ['혜민'] },
  { name: '배한솔', slackUid: 'U05DFV9UAN5', aliases: ['한솔', '한솔쿤'] },
  { name: '이다은', slackUid: 'U068C1BKPRT', aliases: ['다은'] },
  { name: '장재영', slackUid: 'U0760LKJ5D4', aliases: ['재영'] },
  { name: '김어진', slackUid: 'U090WLY7XLH', aliases: ['어진'] },
  { name: '안지상', slackUid: 'U096RV2BLH4', aliases: ['지상'] },
  { name: '류이레', slackUid: 'U0978NUD5L7', aliases: ['이레'] },
  { name: '류성철', slackUid: 'U0A7KTD4Z4G', aliases: ['성철'] },
  { name: '이승은', slackUid: 'U0A9FPUH3BQ', aliases: ['승은'] }
];

/**
 * 이름으로 팀 멤버 찾기
 * @param {string} name - 찾을 이름
 * @returns {object|null} { name, slackUid } 또는 null
 */
export function findMemberByName(name) {
  if (!name) return null;
  const trimmed = name.trim();
  // 정확한 이름 매칭 우선
  const exact = TEAM_MEMBERS.find(m => m.name === trimmed);
  if (exact) return exact;
  // 별명(aliases) 매칭
  return TEAM_MEMBERS.find(m => m.aliases && m.aliases.some(a => a === trimmed)) || null;
}

/**
 * 이름으로 Slack UID 조회
 * @param {string} name - 이름
 * @returns {string|null} Slack UID 또는 null
 */
export function getSlackUidByName(name) {
  const member = findMemberByName(name);
  return member ? member.slackUid : null;
}

/**
 * Slack UID로 팀 멤버 찾기
 * @param {string} uid - Slack UID
 * @returns {object|null} { name, slackUid } 또는 null
 */
export function findMemberBySlackUid(uid) {
  if (!uid) return null;
  return TEAM_MEMBERS.find(m => m.slackUid === uid) || null;
}
