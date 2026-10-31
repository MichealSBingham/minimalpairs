"""Read and invalid-input checks against the already running loopback server."""
import requests

URL='http://127.0.0.1:8767'
checks=[]
for method,path,kwargs,expected in [
    ('get','/api/config',{},200),
    ('get','/',{},200),
    ('get','/speaking_engine.py',{},404),
    ('get','/api/config',{'headers':{'Host':'unrelated.example'}},403),
    ('post','/api/measure',{'headers':{'Origin':'https://unrelated.example'},'data':b'x'},403),
    ('post','/api/measure',{'data':b'not audio'},400),
    ('post','/api/measure',{},400),
    ('post','/api/example?id=missing',{},404),
]:
    response=getattr(requests,method)(URL+path,timeout=10,**kwargs)
    assert response.status_code==expected,(path,response.status_code,response.text)
    assert response.headers['Cache-Control']=='no-store'
    checks.append(f'{method.upper()} {path}: {expected}')
print('\n'.join(checks))
