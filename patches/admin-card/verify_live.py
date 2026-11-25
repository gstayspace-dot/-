"""Public read-only HTTP validation; never creates orders or calls payment providers."""
import json,re
from pathlib import Path
import httpx

report={'actual_orders_created':0,'actual_payment_requests':0,'actual_sms':0,'domains':{}}
with httpx.Client(timeout=40,follow_redirects=False,trust_env=False) as c:
    for origin in ['https://yeongjinsangsa-865821327055.asia-northeast3.run.app','https://xn--oi2bm5bw2c73c.com']:
        item={}
        for path in ['/','/cart','/api/commerce/config','/api/payapp/request','/api/admin/orders']:
            r=c.get(origin+path);item[path]=r.status_code
            assert r.status_code==(401 if path=='/api/admin/orders' else 200)
            if path=='/api/payapp/request':assert r.json()['enabled'] is True
        page=c.get(origin+'/admin/orders');item['admin_page_status']=page.status_code
        scripts=[x for x in re.findall(r'<script[^>]+src="([^"]+)"',page.text) if x.startswith('/_next/') and '/admin/orders/' in x]
        content=''
        for script in scripts:
            r=c.get(origin+script);r.raise_for_status();content+=r.text
        item['admin_order_scripts_checked']=len(scripts)
        item['card_selector_in_deployed_script']='카드결제 · 페이앱' in content
        item['cash_selector_in_deployed_script']='현금결제 · 기존 계좌이체' in content
        item['card_link_button_in_deployed_script']='페이앱 카드결제 링크 열기' in content
        if scripts:assert all(item[k] for k in ['card_selector_in_deployed_script','cash_selector_in_deployed_script','card_link_button_in_deployed_script'])
        report['domains'][origin]=item
out=Path(__file__).with_name('live-verification.json')
out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=True))
