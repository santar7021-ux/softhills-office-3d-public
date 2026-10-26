# ㈜소프트힐스 3D 자리 배치도 (공개용)

서울 본사 / 부산 지사 / 울산 지사 자리 배치를 3D로 보여주는 공개용 페이지입니다.
개인정보 보호를 위해 이름은 **초성(이니셜)** 로만 표시됩니다.

- 실명이 포함된 원본/관리용 데이터는 **Private 저장소** `softhills-office-3d` 와 사내 공유 드라이브에서만 관리합니다.
- 이 저장소의 `js/office_data.js` 는 그 원본에서 이름만 초성으로 치환해서 만든 파생본입니다. 좌석/인사 정보가 바뀌면 원본(Private 저장소)을 먼저 고치고, 거기서 다시 초성 처리본을 만들어 이 저장소에 반영하세요.

## 보기

GitHub Pages: https://santar7021-ux.github.io/softhills-office-3d-public/

## 구조

```
index.html        뼈대 + 탭(서울/부산/울산) + 레이아웃
css/style.css      스타일
js/office_data.js  좌석/회의실/팀 데이터 (이름은 초성 처리됨)
js/app.js          Three.js 렌더링 로직
```
