# UI 평가에 사용한 공식 기준

접근일: 2026-09-06. 웹 접근성 지침을 데스크톱 Electron UI의 평가 기준으로 참고한다. 이 자료만으로 법적 적합성이나 WCAG 전체 준수를 판정하지 않는다.

- W3C, [Understanding SC 1.4.3 Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum): 보통 크기 텍스트 4.5:1, 큰 텍스트 3:1. 비활성 컨트롤·로고 등 예외가 있다. 12px라는 숫자만으로 대비 기준 위반이 되지는 않는다. 폰트 크기·획·읽기 거리·언어는 별도 사용성 판단이다.
- W3C, [Understanding SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html): 컨트롤·상태 식별에 필요한 시각 정보는 인접 색과 3:1. 장식 구분선 모두에 3:1을 강제하지 않는다. 읽을 수 있는 글자·아이콘이 이미 식별 수단이면 모든 버튼 외곽선이 별도로 필수인 것도 아니다.
- W3C, [Understanding SC 2.5.8 Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): 기본 24×24 CSSpx와 간격·동등한 조작·인라인·브라우저 기본·필수 표현 예외를 함께 검토한다. 44×44를 AA의 일괄 의무로 쓰지 않는다. 타임라인 밀도와 오조작 방지를 함께 검증한다.
- W3C, [Understanding SC 2.4.11 Focus Not Obscured Minimum](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html): 작성자가 만든 내용 때문에 키보드 포커스 대상 전체가 가려지는 문제를 다룬다. 실제 탭 이동과 가림을 확인해야 한다.
- Microsoft, [Content layout and spacing](https://learn.microsoft.com/en-us/windows/apps/design/basics/content-basics): 일정한 간격으로 의미 있는 집합을 만들고, 좁은 공간에서는 제목 크기를 과장하기보다 굵기·캡션을 활용한다. 문서의 간격 예시는 BAEFRAME의 필수 픽셀 값이 아니라 설계 참고다.
- Microsoft, [Windows application best practices](https://learn.microsoft.com/en-us/windows/apps/get-started/best-practices): 여러 창 크기·DPI·스케일에서 패널과 페이지를 시험하고 작은 창에서도 내용에 접근 가능하도록 설계한다. 특정 Windows 프레임워크의 자동 DPI 지원을 Electron의 보장으로 옮기지 않는다.

설계 제안의 13/14px 기본 글자, 28/32px 컨트롤, 패널 폭과 응답 시간 목표 등은 이번 제안서의 제품 목표다. 표준이 그 수치를 직접 명령한다고 주장하지 않는다.
