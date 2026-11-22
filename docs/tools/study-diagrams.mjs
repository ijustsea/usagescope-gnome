// Original vector diagrams. No remote images, scripts or reference-image content.
const C={ink:'#0d1b46',muted:'#4d5d7b',blue:'#2864dc',orange:'#d47b32',green:'#078665',purple:'#8252cf',line:'#9db4df'};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function text(x,y,value,size=18,bold=false,color=C.ink,anchor='start'){
 return '<text x="'+x+'" y="'+y+'" fill="'+color+'" font-family="NanumGothic, sans-serif" font-size="'+size+'" font-weight="'+(bold?'700':'400')+'" text-anchor="'+anchor+'">'+esc(value)+'</text>';
}
function group(x,y,w,h,title,color=C.line,fill='#f8fbff'){
 return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="16" fill="'+fill+'" stroke="'+color+'" stroke-dasharray="7 6" stroke-width="1.4"/>'+text(x+18,y+29,title,20,true);
}
function node(x,y,w,h,title,lines=[],color=C.blue,badge=''){
 let out='<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="12" fill="white" stroke="'+C.line+'" stroke-width="1.4"/>';
 if(badge){out+='<rect x="'+(x+14)+'" y="'+(y+14)+'" width="30" height="28" rx="7" fill="'+color+'"/>'+text(x+29,y+34,badge,15,true,'white','middle');}
 out+=text(x+(badge?55:16),y+34,title,20,true);
 lines.forEach((line,i)=>{out+=text(x+16,y+61+i*25,line,17,false,C.muted);});
 return out;
}
function arrow(points,color,label='',labelX=0,labelY=0,double=false,dashed=false){
 let out='<polyline points="'+points.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2.2" stroke-linejoin="round"'+(dashed?' stroke-dasharray="7 5"':'')+'/>';
 const head=(a,b)=>{const ang=Math.atan2(b[1]-a[1],b[0]-a[0]),len=11,spread=.5;return '<polygon points="'+[b,[b[0]-len*Math.cos(ang-spread),b[1]-len*Math.sin(ang-spread)],[b[0]-len*Math.cos(ang+spread),b[1]-len*Math.sin(ang+spread)]].map(p=>p.join(',')).join(' ')+'" fill="'+color+'"/>';};
 out+=head(points.at(-2),points.at(-1));
 if(double)out+=head(points[1],points[0]);
 if(label){const width=[...label].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?16:8),0)+14;
 out+='<rect x="'+(labelX-6)+'" y="'+(labelY-18)+'" width="'+width+'" height="23" rx="5" fill="white"/>'+text(labelX,labelY,label,16,true,color);}
 return out;
}
function svg(w,h,body){
 return '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><rect width="100%" height="100%" fill="white"/>'+body+'</svg>';
}
export function architecture(){
 let b=text(30,44,'UsageScope | 전체 구성',32,true)+text(30,80,'실행 위치·데이터 경로·인증 소유권을 구분한 로컬 GNOME 구성',18);
 b+=group(20,105,1400,110,'개발·검증·배포',C.line,'#fbfcff');
 b+=group(20,285,1030,555,'사용자 PC · Fedora / GNOME / Wayland');
 b+=group(1080,285,340,340,'외부 공식 서비스',C.line,'#fcfcff');
 b+=group(1080,650,340,190,'사용자 PC · 브라우저',C.line,'#fbfcff');
 b+=group(630,335,405,490,'GNOME Shell 프로세스 · GJS',C.blue,'#f4f8ff');
 b+=arrow([[240,177],[285,177]],C.purple);
 b+=arrow([[515,177],[560,177]],C.purple);
 b+=arrow([[800,177],[845,177]],C.purple);
 b+=arrow([[1045,177],[1090,177]],C.purple);
 b+=arrow([[175,390],[175,325],[1245,325],[1245,365]],C.blue,'HTTPS · 공식 CLI 조회',440,313);
 b+=arrow([[55,570],[35,570],[35,245],[1410,245],[1410,555],[1395,555]],C.orange,'기존 Claude 활동의 HTTPS 통신',430,233);
 b+=arrow([[295,432],[650,432]],C.blue,'stdio · JSONL',380,417,true);
 b+=arrow([[265,575],[310,575]],C.orange);
 b+=arrow([[445,530],[445,510]],C.orange);
 b+=arrow([[445,625],[445,665]],C.orange,'최소 필드만 발행',460,650);
 b+=arrow([[580,715],[610,715],[610,550],[650,550]],C.orange);
 b+=arrow([[835,585],[835,630]],C.green);
 b+=arrow([[835,715],[835,740]],C.green);
 b+=arrow([[580,805],[650,777]],C.green);
 b+=arrow([[55,432],[45,432],[45,755],[55,755]],C.purple,'CLI 인증 관리',70,689,false,true);
 b+=arrow([[55,575],[50,575],[50,780],[55,780]],C.purple,'',0,0,false,true);
 b+=arrow([[1020,777],[1060,777],[1060,752],[1100,752]],C.purple,'웹 버튼',1028,735,false,true);
 b+=node(40,142,200,60,'GitHub',[],C.ink,'G');
 b+=node(285,142,230,60,'GitHub Actions',[],C.blue,'CI');
 b+=node(560,142,240,60,'tsc · 테스트 · pack',[],C.purple,'TS');
 b+=node(845,142,200,60,'설치 ZIP',[],C.green,'ZIP');
 b+=node(1090,142,310,60,'명시적 설치 · 코드 적용',[],C.purple,'UI');
 b+=node(55,390,240,95,'공식 Codex CLI',['App Server · stdio','조회·로그인 중만 실행'],C.blue,'C');
 b+=node(55,530,210,95,'Claude Code',['사용자가 실행 중인 CLI','상태줄이 JSON을 전달'],C.orange,'C');
 b+=node(310,465,270,45,'선택적 CLI auth status',[],C.orange);
 b+=node(310,530,270,95,'GJS 전달 도구',['필드 투영 · 추가 모델 호출 없음','구독 정보는 300초 캐시'],C.orange,'JS');
 b+=node(310,665,270,100,'런타임 JSON 파일',['스냅샷 · 구독 캐시','디렉터리 0700 / 파일 0600'],C.green,'F');
 b+=node(55,710,210,105,'CLI 인증 저장소',['공식 CLI가 관리','UsageScope 직접 접근 없음'],C.purple,'K');
 b+=node(310,780,270,50,'GNOME 설정 · GSettings',[],C.green);
 b+=node(650,380,370,205,'공급자 어댑터',[],C.blue,'A');
 b+=node(670,420,330,60,'Codex Controller + RPC',[],C.blue);
 b+=node(670,510,330,60,'Claude Controller + Watch',[],C.orange);
 b+=node(650,630,370,85,'검증 · 상태 · 출처 관리',['누락 / 과거값 / 만료 / 계정 변경 구분'],C.green,'V');
 b+=node(650,740,370,75,'상단바 · 카드 · 알림',['구독 등급 · 잔여율 · 명시적 설정'],C.green,'UI');
 b+=node(1100,365,295,90,'OpenAI 공식 서비스',['CLI 인증 · 계정 한도 응답'],C.blue,'O');
 b+=node(1100,515,295,90,'Anthropic 공식 서비스',['Claude의 기존 활동·인증'],C.orange,'A');
 b+=node(1100,700,295,105,'기본 브라우저',['chatgpt.com / claude.ai','사이트 열기 ≠ 로컬 CLI 연결'],C.purple,'W');
 b+=text(30,883,'파랑  Codex 요청·응답',17,true,C.blue)+text(335,883,'주황  Claude 수신',17,true,C.orange)+text(655,883,'초록  검증·로컬 저장·표시',17,true,C.green)+text(1080,883,'보라  배포·사용자·인증',17,true,C.purple);
 b+=text(30,916,'논리적 흐름도: 파이프·파일 경로는 네트워크 서버가 아닙니다. 웹 로그인과 CLI 인증 상태는 별개입니다.',16,false,C.muted);
 return svg(1440,940,b);
}
export function flow(){
 let b=text(30,44,'UsageScope | 서비스 동작 흐름',32,true)+text(30,80,'같은 화면으로 합치되, 요청형 Codex와 수신형 Claude를 다르게 처리합니다.',18);
 b+=group(20,120,1400,185,'Codex · 필요한 때 조회',C.blue);
 const codex=[
 ['1. 모니터링 켜기',['사용자가 명시적으로 선택']],
 ['2. 경로·권한 검사',['신뢰한 CLI를 argv로 실행']],
 ['3. 초기화·한도 요청',['JSONL ID로 응답 연결']],
 ['4. 입력·계정 검사',['범위·기간·출처 확인']],
 ['5. 잔여율 표시',['사용률 97 → 잔여 3%']],
 ['6. 프로세스 정리',['EOF → 기한 내 종료 대기']],
 ];
 codex.forEach((n,i)=>{const x=35+i*234;if(i<5)b+=arrow([[x+205,226],[x+234,226]],C.blue);b+=node(x,175,205,105,n[0],n[1],C.blue);});
 b+=group(20,345,1400,185,'Claude · 기존 상태줄에서 수신',C.orange);
 const claude=[
 ['1. 상태줄 JSON',['기존 Claude가 전달']],
 ['2. 전달 도구 실행',['입력량·필드 검증']],
 ['3. 최소 정보만 추출',['선택적 구독 정보 캐시']],
 ['4. 불변 파일 발행',['고유 이름·원자적 이동']],
 ['5. 변경 알림 수신',['명시적 세션 하나 선택']],
 ['6. 마지막 보고 표시',['수신 시각 ≠ 서버 시각']],
 ];
 claude.forEach((n,i)=>{const x=35+i*234;if(i<5)b+=arrow([[x+205,451],[x+234,451]],C.orange);b+=node(x,400,205,105,n[0],n[1],C.orange);});
 b+=group(20,575,1400,195,'공통 안전 규칙',C.green);
 b+=node(55,630,375,105,'오류·누락·만료',['0·null·미보고를 구분','시간 경과로 100%를 만들지 않음'],C.green,'!');
 b+=node(530,630,375,105,'출처·시각·세대 관리',['다른 계정·세션을 합치지 않음','종료 뒤 늦은 응답은 반영하지 않음'],C.green,'S');
 b+=node(1005,630,375,105,'잔여 30 / 회복 35',['30% 이하는 빨강 · 아래 진입 시 알림','Claude 알림은 마지막 보고값 기준'],C.green,'UI');
 b+=arrow([[430,681],[530,681]],C.green);
 b+=arrow([[905,681],[1005,681]],C.green);
 b+=text(30,817,'설정·데이터는 실행 중 갱신됩니다. Wayland에서 JavaScript 코드 변경을 확실히 적용하려면 새 GNOME 세션이 필요합니다.',17,false,C.muted);
 return svg(1440,850,b);
}
