from sqlalchemy import select
from sqlalchemy.orm import Session
from app.Models.user import User
from app.Models.field_force import FieldForce
from app.Models.retailer import Retailer
from app.Models.house import House

class AccessControl:
    def __init__(self, user: User, session: Session):
        self.user = user
        self.session = session
        self.role_names = [r.name.lower() for r in user.roles]

    async def get_data_filters(self, model):
        """
        Returns a list of SQLAlchemy filter conditions based on user role and profile.
        Supports models that have house_id, field_force_id, or retailer_id/retailer_code.
        """
        filters = []
        
        # 1. House Manager / Admin / Super Admin (Can see everything in their assigned houses)
        if any(role in self.role_names for role in ['admin', 'super_admin', 'manager', 'house_manager']):
            house_ids = [h.id for h in self.user.houses]
            if hasattr(model, 'house_id'):
                filters.append(model.house_id.in_(house_ids))
            return filters

        # 2. Supervisor / Field Manager
        # Note: We check if the user has a field_force_profile and its type
        ff_profile = self.user.field_force_profile
        if ff_profile and ff_profile.type == 'Supervisor':
            # Get all RSOs under this supervisor
            sub_res = await self.session.execute(
                select(FieldForce.id).where(FieldForce.supervisor_id == ff_profile.id)
            )
            rso_ids = [r[0] for r in sub_res.all()]
            # Include the supervisor's own ID just in case they have personal targets/activations
            rso_ids.append(ff_profile.id)
            
            if hasattr(model, 'field_force_id'):
                filters.append(model.field_force_id.in_(rso_ids))
            elif hasattr(model, 'house_id'):
                filters.append(model.house_id == ff_profile.house_id)
            return filters

        # 3. RSO (Field Force - SR/BP)
        if ff_profile and ff_profile.type in ['SR', 'BP', 'RSO']:
            if hasattr(model, 'field_force_id'):
                filters.append(model.field_force_id == ff_profile.id)
            elif hasattr(model, 'retailer_code'):
                # For models that link by retailer code
                ret_res = await self.session.execute(
                    select(Retailer.retailer_code).where(Retailer.field_force_id == ff_profile.id)
                )
                ret_codes = [r[0] for r in ret_res.all()]
                filters.append(model.retailer_code.in_(ret_codes))
            return filters

        # 4. Retailer
        # Assuming we might add a retailer_profile relationship to User later
        # Or identify them via their phone number/telegram_id
        # For now, let's look up if this user is a retailer
        ret_res = await self.session.execute(
            select(Retailer).where(Retailer.contact_no == self.user.phone_number)
        )
        retailer = ret_res.scalar_one_or_none()
        if retailer:
            if hasattr(model, 'retailer_id'):
                filters.append(model.retailer_id == retailer.id)
            elif hasattr(model, 'retailer_code'):
                filters.append(model.retailer_code == retailer.retailer_code)
            return filters

        # Default: If no profile/role matches, return a filter that matches nothing (Security first)
        filters.append(False) 
        return filters

    async def apply_filters(self, query, model):
        """Applies filters directly to a SQLAlchemy query object"""
        conditions = await self.get_data_filters(model)
        for cond in conditions:
            if cond is not False:
                query = query.where(cond)
            else:
                # Force empty result
                query = query.where(model.id == -1) 
        return query
