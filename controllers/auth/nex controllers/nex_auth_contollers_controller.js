const pool = require('../../../db');
const bcrypt = require('bcryptjs');


const createController = async (req, res) => {
  const { name, email, company_id, password } = req.body;

  if (!name || !email || !company_id || !password) {
    return res.status(400).json({ error: 'Name, email, company_id, and password are required' });
  }

  try {
    
    const companyResult = await pool.query('SELECT id FROM customers_nex_lock WHERE id = $1', [company_id]);
    if (companyResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid company_id' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const controllerResult = await pool.query(
      'INSERT INTO controllers_nex_lock (name, email, role, company_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, email, 'controller', company_id, true]
    );

    const controller = controllerResult.rows[0];

    await pool.query(
      'INSERT INTO users_nex_lock (email, password, role, company_id) VALUES ($1, $2, $3, $4)',
      [email, hashedPassword, 'controller', company_id]
    );

    res.status(201).json(controller);
  } catch (error) {
    console.error('Error creating controller:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all controllers
const getControllers = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM controllers_nex_lock ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching controllers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get a controller by ID
const getControllerById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM controllers_nex_lock WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Controller not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching controller:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get controllers by company_id
const getControllersByCompany = async (req, res) => {
  const { companyId } = req.params;
  try {
    const result = await pool.query('SELECT * FROM controllers_nex_lock WHERE company_id = $1 ORDER BY id', [companyId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching controllers by company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all users by company_id (for controllers to see all company users)
const getAllUsersByCompany = async (req, res) => {
  const { companyId } = req.params;
  try {
    // Get all users from users_nex_lock table with the company_id
    const usersResult = await pool.query('SELECT id, email, role, company_id FROM users_nex_lock WHERE company_id = $1 ORDER BY id', [companyId]);

    // Get additional info for controllers
    const controllerEmails = usersResult.rows.filter(user => user.role === 'controller').map(user => user.email);
    let controllersInfo = {};

    if (controllerEmails.length > 0) {
      const controllersResult = await pool.query(
        'SELECT email, name, status FROM controllers_nex_lock WHERE email = ANY($1)',
        [controllerEmails]
      );

      controllersInfo = controllersResult.rows.reduce((acc, controller) => {
        acc[controller.email] = { name: controller.name, status: controller.status };
        return acc;
      }, {});
    }

    // Combine user info with controller details
    const users = usersResult.rows.map(user => ({
      id: user.id,
      email: user.email,
      role: user.role,
      company_id: user.company_id,
      ...(controllersInfo[user.email] || {})
    }));

    res.json(users);
  } catch (error) {
    console.error('Error fetching all users by company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update a controller
const updateController = async (req, res) => {
  const { id } = req.params;
  const { name, email, company_id, status } = req.body;

  try {
 
    if (company_id) {
      const companyResult = await pool.query('SELECT id FROM customers_nex_lock WHERE id = $1', [company_id]);
      if (companyResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid company_id' });
      }
    }

    const currentResult = await pool.query('SELECT email FROM controllers_nex_lock WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Controller not found' });
    }
    const oldEmail = currentResult.rows[0].email;

 
    const result = await pool.query(
      'UPDATE controllers_nex_lock SET name = $1, email = $2, company_id = $3, status = $4 WHERE id = $5 RETURNING *',
      [name, email, company_id, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Controller not found' });
    }

  
    if (email && email !== oldEmail) {
      await pool.query('UPDATE users_nex_lock SET email = $1 WHERE email = $2', [email, oldEmail]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating controller:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


const deleteController = async (req, res) => {
  const { id } = req.params;
  try {
   
    const controllerResult = await pool.query('SELECT email FROM controllers_nex_lock WHERE id = $1', [id]);
    if (controllerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Controller not found' });
    }
    const email = controllerResult.rows[0].email;


    await pool.query('DELETE FROM controllers_nex_lock WHERE id = $1', [id]);

  
    await pool.query('DELETE FROM users_nex_lock WHERE email = $1', [email]);

    res.json({ message: 'Controller deleted successfully' });
  } catch (error) {
    console.error('Error deleting controller:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createController,
  getControllers,
  getControllerById,
  getControllersByCompany,
  getAllUsersByCompany,
  updateController,
  deleteController,
};
