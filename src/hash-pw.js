// src/hash-pw.js
// 공유 로그인 비밀번호의 bcrypt 해시 생성 도우미.
// 사용법: node src/hash-pw.js '평문비밀번호'
// 출력된 해시를 .env의 APP_PASSWORD_HASH= 에 붙여넣는다. (평문은 저장 금지)

import bcrypt from 'bcryptjs';

const plain = process.argv[2];

if (!plain) {
  // eslint-disable-next-line no-console
  console.error("usage: node src/hash-pw.js '<평문 비밀번호>'");
  process.exit(1);
}

const ROUNDS = 10;
const hash = bcrypt.hashSync(plain, ROUNDS);

// 해시만 stdout으로 출력(그대로 .env에 복사 가능).
// eslint-disable-next-line no-console
console.log(hash);
