// Supabase 마이그레이션 SQL 실행 스크립트
//
// 사용법:
//   1) .env.local 에 DB 연결 문자열 추가 (Supabase 대시보드 → Connect → Connection string):
//        SUPABASE_DB_URL=postgresql://postgres.xxxx:비밀번호@aws-...pooler.supabase.com:5432/postgres
//   2) 실행:
//        node scripts/run-migration.mjs supabase/migrations/add_product_sort_order.sql
//
// 인자를 생략하면 add_product_sort_order.sql 을 실행합니다.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

// .env.local 에서 SUPABASE_DB_URL 직접 로드 (Next 런타임이 아니므로 수동 파싱)
function loadEnvLocal() {
  try {
    const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    // .env.local 이 없으면 무시 (이미 환경변수로 들어왔을 수 있음)
  }
}

async function main() {
  loadEnvLocal()

  const connectionString = process.env.SUPABASE_DB_URL
  if (!connectionString) {
    console.error('❌ SUPABASE_DB_URL 이 설정되어 있지 않습니다.')
    console.error('   .env.local 에 Supabase DB 연결 문자열을 추가하세요. (대시보드 → Connect → Connection string)')
    process.exit(1)
  }

  const sqlPath = process.argv[2] || 'supabase/migrations/add_product_sort_order.sql'
  const sql = readFileSync(resolve(process.cwd(), sqlPath), 'utf8')

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Supabase 는 SSL 필요
  })

  console.log(`▶ 연결 중...`)
  await client.connect()
  console.log(`▶ 실행: ${sqlPath}`)
  try {
    await client.query(sql)
    console.log('✅ 마이그레이션 완료')
  } catch (err) {
    console.error('❌ 실행 실패:', err.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main()
