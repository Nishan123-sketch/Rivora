// Priority monitoring catalog; NOT a ranking of highest flood danger.
// The WAMIS metadata rivnm field is used to prove a gauge belongs to a river.
const rows = [
 ['ulsan','Ulsan','taehwa','태화강','Taehwa River'],
 ['ulsan','Ulsan','dongcheon','동천','Dongcheon'],
 ['ulsan','Ulsan','hoeya','회야강','Hoeya River'],
 ['ulsan','Ulsan','oehwang','외황강','Oehwang River'],
 ['ulsan','Ulsan','cheokgwa','척과천','Cheokgwa Stream'],
 ['nakdong','Nakdong Basin','nakdong','낙동강','Nakdong River'],
 ['nakdong','Nakdong Basin','geumho','금호강','Geumho River'],
 ['nakdong','Nakdong Basin','hyeongsan','형산강','Hyeongsan River'],
 ['nakdong','Nakdong Basin','nam','남강','Nam River'],
 ['han','Han Basin','han','한강','Han River'],
 ['han','Han Basin','imjin','임진강','Imjin River'],
 ['han','Han Basin','bukhan','북한강','Bukhan River'],
 ['han','Han Basin','anseong','안성천','Anseong Stream'],
 ['han','Han Basin','jungnang','중랑천','Jungnang Stream'],
 ['geum','Geum Basin','geum','금강','Geum River'],
 ['geum','Geum Basin','gap','갑천','Gap Stream'],
 ['geum','Geum Basin','sapgyo','삽교천','Sapgyo Stream'],
 ['geum','Geum Basin','mangyeong','만경강','Mangyeong River'],
 ['geum','Geum Basin','dongjin','동진강','Dongjin River'],
 ['yeongsan','Yeongsan Basin','yeongsan','영산강','Yeongsan River'],
 ['yeongsan','Yeongsan Basin','hwangryong','황룡강','Hwangryong River'],
 ['yeongsan','Yeongsan Basin','jiseok','지석천','Jiseok Stream'],
 ['yeongsan','Yeongsan Basin','hampyeong','함평천','Hampyeong Stream'],
 ['yeongsan','Yeongsan Basin','gomakwon','고막원천','Gomakwon Stream'],
 ['seomjin','Seomjin Basin','seomjin','섬진강','Seomjin River'],
 ['seomjin','Seomjin Basin','boseong','보성강','Boseong River'],
 ['seomjin','Seomjin Basin','yocheon','요천','Yocheon Stream'],
 ['seomjin','Seomjin Basin','tamjin','탐진강','Tamjin River']
];
// Catalog candidates, not claims of verified monitoring or flood-warning levels.
const additionalRows = [
 ['han','Han Basin','dalcheon','달천','Dalcheon'],
 ['han','Han Basin','seomgang','섬강','Seomgang'],
 ['han','Han Basin','cheongmi','청미천','Cheongmi Stream'],
 ['han','Han Basin','bokha','복하천','Bokha Stream'],
 ['han','Han Basin','yanggu_seocheon','양구서천','Yanggu Seocheon'],
 ['han','Han Basin','soyang','소양강','Soyang River'],
 ['han','Han Basin','gyeongan','경안천','Gyeongan Stream'],
 ['han','Han Basin','anyang','안양천','Anyang Stream'],
 ['han','Han Basin','gulpo','굴포천','Gulpo Stream'],
 ['han','Han Basin','gongneung','공릉천','Gongneung Stream'],
 ['han','Han Basin','munsan','문산천','Munsan Stream'],
 ['han','Han Basin','jinwi','진위천','Jinwi Stream'],
 ['han','Han Basin','osan','오산천','Osan Stream'],
 ['han','Han Basin','hwangguji','황구지천','Hwangguji Stream'],
 ['han','Han Basin','ara','아라천','Ara Stream'],
 ['han','Han Basin','hongcheon','홍천강','Hongcheon River'],
 ['han','Han Basin','pyeongchang','평창강','Pyeongchang River'],
 ['han','Han Basin','jucheon','주천강','Jucheon River'],
 ['han','Han Basin','tancheon','탄천','Tancheon Stream'],
 ['han','Han Basin','wangsuk','왕숙천','Wangsuk Stream'],
 ['han','Han Basin','gokneung','곡릉천','Gokneung Stream'],
 ['nakdong','Nakdong Basin','banbyeon','반변천','Banbyeon Stream'],
 ['nakdong','Nakdong Basin','naeseong','내성천','Naeseong Stream'],
 ['nakdong','Nakdong Basin','gamcheon','감천','Gamcheon Stream'],
 ['nakdong','Nakdong Basin','hwanggang','황강','Hwang River'],
 ['nakdong','Nakdong Basin','deokcheon','덕천강','Deokcheon River'],
 ['nakdong','Nakdong Basin','haman','함안천','Haman Stream'],
 ['nakdong','Nakdong Basin','miryang','밀양강','Miryang River'],
 ['nakdong','Nakdong Basin','yangsan','양산천','Yangsan Stream'],
 ['nakdong','Nakdong Basin','seo_nakdong','서낙동강','West Nakdong River'],
 ['nakdong','Nakdong Basin','pyeonggang','평강천','Pyeonggang Stream'],
 ['nakdong','Nakdong Basin','maekdo','맥도강','Maekdo River'],
 ['nakdong','Nakdong Basin','gahwa','가화천','Gahwa Stream'],
 ['nakdong','Nakdong Basin','wicheon','위천','Wicheon Stream'],
 ['nakdong','Nakdong Basin','hwangji','황지천','Hwangji Stream'],
 ['nakdong','Nakdong Basin','hoesang','회상천','Hoesang Stream'],
 ['geum','Geum Basin','yudong','유동천','Yudong Stream'],
 ['geum','Geum Basin','miho','미호천','Miho Stream'],
 ['geum','Geum Basin','nonsan','논산천','Nonsan Stream'],
 ['geum','Geum Basin','noseong','노성천','Noseong Stream'],
 ['geum','Geum Basin','ganggyeong','강경천','Ganggyeong Stream'],
 ['geum','Geum Basin','muhan','무한천','Muhan Stream'],
 ['geum','Geum Basin','gokgyo','곡교천','Gokgyo Stream'],
 ['geum','Geum Basin','soyang_jeonbuk','소양천','Soyang Stream (Jeonbuk)'],
 ['geum','Geum Basin','jeonju','전주천','Jeonju Stream'],
 ['geum','Geum Basin','jeongeup','정읍천','Jeongeup Stream'],
 ['geum','Geum Basin','gobu','고부천','Gobu Stream'],
 ['geum','Geum Basin','wonpyeong','원평천','Wonpyeong Stream'],
 ['geum','Geum Basin','daejeon','대전천','Daejeon Stream'],
 ['geum','Geum Basin','yudeung','유등천','Yudeung Stream'],
 ['geum','Geum Basin','byeongcheon','병천천','Byeongcheon Stream'],
 ['yeongsan','Yeongsan Basin','gwangju','광주천','Gwangju Stream'],
 ['yeongsan','Yeongsan Basin','pungyeong','풍영정천','Pungyeongjeong Stream'],
 ['yeongsan','Yeongsan Basin','muan','무안천','Muan Stream'],
 ['yeongsan','Yeongsan Basin','naju','나주천','Naju Stream'],
 ['yeongsan','Yeongsan Basin','damyang','담양천','Damyang Stream'],
 ['yeongsan','Yeongsan Basin','yongjeon','용전천','Yongjeon Stream'],
 ['seomjin','Seomjin Basin','osoo','오수천','Osu Stream'],
 ['seomjin','Seomjin Basin','gyeongcheon','경천','Gyeong Stream'],
 ['seomjin','Seomjin Basin','dongbok','동복천','Dongbok Stream'],
 ['seomjin','Seomjin Basin','songgwang','송광천','Songgwang Stream'],
 ['seomjin','Seomjin Basin','gokseong','곡성천','Gokseong Stream'],
 ['ulsan','Ulsan','myeongchon','명촌천','Myeongchon Stream'],
 ['ulsan','Ulsan','mugeo','무거천','Mugeo Stream'],
 ['ulsan','Ulsan','yaksa','약사천','Yaksa Stream'],
 ['ulsan','Ulsan','yeocheon','여천천','Yeocheon Stream'],
 ['ulsan','Ulsan','duwang','두왕천','Duwang Stream'],
 ['ulsan','Ulsan','maegok','매곡천','Maegok Stream'],
 ['ulsan','Ulsan','janghyeon','장현천','Janghyeon Stream'],
 ['ulsan','Ulsan','bangu','반구천','Bangu Stream'],
 ['ulsan','Ulsan','seonam','선암천','Seonam Stream'],
 ['ulsan','Ulsan','cheonjeon','천전천','Cheonjeon Stream'],
];

const catalog = [...rows, ...additionalRows].map(([region_id, region, river_id, name_ko, name_en])=> ({region_id, region, river_id, name_ko, name_en}));
if (catalog.length !== 100 || new Set(catalog.map(r => r.river_id)).size !== 100) {
 throw new Error('River catalog must contain exactly 100 unique IDs');
}
const ulsanBounds = {minLat:35.25,maxLat:35.83,minLon:128.93,maxLon:129.65};
function matchRiver(station){
 const name=String(station?.riverName||'').trim().replace(/\s+/g,'').replace(/[()（）]/g,'');
 if(!name) return null;
 return catalog.find(r => {
   const target=r.name_ko.replace(/\s+/g,'');
   if(name !== target && name !== `${target}본류`) return false;
   // "동천" and "척과천" are not unique names nationwide.
   if(r.region_id==='ulsan') {
     const {lat,lon}=station;
     return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=ulsanBounds.minLat&&lat<=ulsanBounds.maxLat&&lon>=ulsanBounds.minLon&&lon<=ulsanBounds.maxLon;
   }
   // New candidate rivers with potentially reused names require coordinates.
   if (additionalRows.some(entry => entry[2] === r.river_id)) {
     if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return false;
   }
   return true;
 }) || null;
}
module.exports={catalog, matchRiver};
