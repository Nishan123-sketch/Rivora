export default function AccountMenu({user,onNavigate,onLogout}){
 const name=user.display_name||user.email,initials=name.split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
 return <details className="account-menu"><summary><span className="account-avatar" aria-hidden="true">{initials}</span><span className="account-label"><b>{name}</b><small>{user.account_type} account</small></span></summary><div className="account-dropdown"><button onClick={()=>onNavigate('Profile')}>My Profile</button><button onClick={()=>onNavigate('Alerts')}>Alert Settings</button>{user.role==='ADMIN'&&<button onClick={()=>onNavigate('Admin')}>Administrator dashboard</button>}<button onClick={onLogout}>Logout</button></div></details>;
}
