# 리빙라방 네이버 검색 제목 변경 작업 인계

작성일: 2026-11-14 (KST)

## 목표와 현재 상태

사용자는 네이버에서 "리빙라방"으로 홈페이지를 찾고, 검색 제목이 "바이미니 라이브쇼핑" 대신 "리빙라방 | 주방·생활용품 라이브쇼핑"으로 표시되길 요청했습니다.

- 운영 주소: https://xn--oi2bm5bw2c73c.com/ (리빙라방.com)
- Cloud Run 주소: https://yeongjinsangsa-865821327055.asia-northeast3.run.app/
- PC 및 모바일 네이버에서 "리빙라방" 검색 결과에 운영 홈페이지가 노출되고, 링크로 상품 목록에 접속되는 것을 확인했습니다.
- 운영 HTML의 title, og:title, twitter:title은 아직 "바이미니 라이브쇼핑"입니다.
- 네이버 첫 번째 순위와 검색 제목 반영 시점은 보장할 수 없습니다.
- GitHub 사용자 lkm050901이 gstayspace-dot/- 저장소의 협업 초대를 수락했고 push 권한을 확인했습니다.
- 운영 사이트는 아직 수정하거나 재배포하지 않았습니다.

## 배포 전 반드시 해소할 소스 차이

이 수정안의 기준 main 커밋: 0cfcea7d4ff27f2e18cf904b1e76bad42a08615b.

공유된 main은 현재 운영 사이트와 다릅니다.

1. app/layout.tsx의 기존 제목은 "영진상사 라이브쇼핑"이지만, 운영 사이트는 "바이미니 라이브쇼핑"입니다.
2. app/cart/page.tsx 및 app/my-orders/page.tsx에는 예전 상호와 입금 안내가 남아 있고, 운영 사이트의 사업자·입금 안내와 일치하지 않습니다.
3. 운영 사이트에는 /admin/marketing, /admin/toss, /policy/terms, /policy/privacy, /policy/refund 경로가 보이지만 현재 공유된 소스에는 해당 페이지가 없습니다.
4. .github/workflows/deploy.yml은 main push 시 같은 운영 서비스 yeongjinsangsa(asia-northeast3)를 자동 배포합니다.

따라서 이 구버전 main을 그대로 운영 배포하면 최신 기능과 안내를 되돌릴 수 있습니다. 먼저 실제 운영 중인 최신 소스를 확인해 저장소에 반영한 다음, 아래 작은 수정만 최신 코드에 재적용해야 합니다. 다른 기능의 변경이나 삭제는 이 작업 범위가 아닙니다.

## 준비한 변경 파일

- app/layout.tsx
  - title, openGraph.title, twitter.title: 리빙라방 | 주방·생활용품 라이브쇼핑
  - description, openGraph.description, twitter.description: 리빙라방에서 주방·생활용품과 라이브 방송 특가 상품을 만나보세요. 상품 정보와 주문을 간편하게 확인하세요.
  - 기존 주문, 결제, 입금, 계정, 디자인 로직은 건드리지 않았습니다.
- public/navere7486b442576a239ff432eb3df3b6768.html
  - 네이버 서치어드바이저에서 해당 도메인용으로 직접 다운로드한 소유확인 파일입니다.
  - 파일 내용: naver-site-verification: navere7486b442576a239ff432eb3df3b6768.html
  - 기존 운영 HTML에 있는 소유확인 메타태그를 제거할 필요가 없는 파일 인증 방식입니다.

현재 수정안은 별도 fix/living-labang-search-title 브랜치 및 Draft PR로 전달합니다. 운영 최신 소스 확인 전에는 main에 병합하지 마세요.

## 완료한 검증

- npm ci --no-audit --no-fund: 성공
- npm run build -- --no-lint: 성공 (Next.js 14.2.35, TypeScript 검사 및 정적 페이지 24개 생성 포함)
- 생성된 .next/server/app/index.html의 title, og:title, twitter:title이 새 제목인지 확인: 성공
- git diff --check: 성공
- 운영 배포 및 네이버 소유확인/재수집: 미완료

## 이어서 진행할 순서

1. 현재 Cloud Run에서 사용 중인 최신 소스와 이 저장소의 차이를 확인하고 최신 소스를 안전하게 반영합니다. 비밀키, .env의 민감한 값, 개인 자료는 저장소나 공개 댓글에 올리지 마세요.
2. 준비된 두 파일의 변경을 최신 소스에 필요한 부분만 재적용합니다. 현재 운영 중인 컴포넌트, 사업자·입금 안내, 기존 소유확인 태그와 설정을 보존합니다.
3. 최신 코드에서 빌드와 관련 검사를 실행합니다.
4. 검증 후 기존 운영 배포 경로로 반영하고 배포 상태를 확인합니다.
5. 운영 HTML의 새 title/OG/Twitter 제목과 인증 파일 URL의 HTTP 200/정확한 본문을 확인합니다.
6. 네이버 서치어드바이저에서 https://리빙라방.com 소유확인을 완료하고, 기존 /sitemap.xml 제출 상태를 확인한 뒤 홈페이지 수집을 요청합니다.
7. 네이버의 실제 검색 제목이 바뀌었는지는 설정 적용 및 재수집 요청 완료와 구분해서 보고합니다.

## 제작 담당자에게 필요한 자료

@gstayspace-dot 님: 현재 운영 중인 최신 홈페이지 소스와 실제 배포 브랜치/경로를 확인해 공유해 주세요. 이 문서와 Draft PR을 김형은님의 Codex에 열면 조사 내용, 변경 코드, 검증 결과를 바로 이어받을 수 있습니다.
