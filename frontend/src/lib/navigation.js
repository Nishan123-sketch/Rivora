export const routes={'Overview Dashboard':'/','Weather Forecast':'/weather','Live Map':'/map','Stations':'/stations','Station Details':'/stations','Historical Data':'/history','River Monitoring':'/rivers','Alerts':'/alerts','AI Assistant':'/assistant','ML Analysis':'/ml','About':'/about','Login':'/login','Register':'/register','Auth Callback':'/auth/callback','Onboarding':'/onboarding','Profile':'/profile','Admin':'/admin','Admin Login':'/admin/login','Account Action':'/account/action'};
export function readLocation(location,base='/'){
 const prefix=base.replace(/\/$/,'');let path=location.pathname.slice(prefix.length)||'/';path=path.replace(/\/$/,'')||'/';
 const match=path.match(/^\/stations\/(\d+)$/);return match?{page:'Station Details',detailId:Number(match[1])}:{page:Object.keys(routes).find(k=>routes[k]===path)||'Overview Dashboard',detailId:null};
}
export function pageUrl(page,id,base='/'){return base.replace(/\/$/,'')+(page==='Station Details'&&id?`/stations/${id}`:routes[page]||'/');}
